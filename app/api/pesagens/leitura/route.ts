import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { weighInAccess } from "@/lib/weigh-ins";
import { parseStarfit } from "@/lib/starfit";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
const execute = promisify(execFile);
const maxBytes = 8 * 1024 * 1024;

export async function POST(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return new Response(null,{status:403});
  const target = new URL(request.url).searchParams.get("cliente");
  const access = await weighInAccess(target ?? undefined);
  if (!access) return new Response(null,{status:403});
  if (!(await rateLimit("generic", `weigh-in-ocr:${access.viewerId}`)).success) {
    return Response.json({ error: "Aguarda um momento antes de tentar outra leitura." },{status:429});
  }
  const size = Number(request.headers.get("content-length"));
  if (size > maxBytes || !request.body) return Response.json({error:"Escolhe um ficheiro até 8 MB."},{status:413});

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done,value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      return Response.json({error:"Escolhe um ficheiro até 8 MB."},{status:413});
    }
    chunks.push(value);
  }
  const data = Buffer.concat(chunks);
  const pdf = data.subarray(0,5).toString() === "%PDF-";
  const jpg = data[0] === 0xff && data[1] === 0xd8;
  const png = data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (!pdf && !jpg && !png) return Response.json({error:"Usa um PDF, JPG ou PNG."},{status:415});

  const folder = await mkdtemp(join(tmpdir(),"leap-weigh-in-"));
  try {
    let input = join(folder,pdf ? "report.pdf" : jpg ? "report.jpg" : "report.png");
    await writeFile(input,data);
    if (pdf) {
      const prefix = join(folder,"page");
      await execute("pdftoppm",["-f","1","-l","1","-scale-to","2400","-singlefile","-png",input,prefix],{timeout:8000});
      input = prefix + ".png";
    }
    const { stdout } = await execute("tesseract",[input,"stdout","-l","por+eng","--psm","6"],{
      timeout:15000,maxBuffer:128*1024,env:{...process.env,OMP_THREAD_LIMIT:"1"},
    });
    return Response.json({ values:parseStarfit(stdout) });
  } catch {
    return Response.json({error:"Não foi possível ler o relatório. Tenta uma foto nítida ou preenche os valores à mão."},{status:422});
  } finally {
    await rm(folder,{recursive:true,force:true});
  }
}
