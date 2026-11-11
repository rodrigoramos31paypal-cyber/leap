"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Camera, Plus } from "lucide-react";
import { saveWeighIn } from "@/app/app/perfil/weigh-in-actions";
import { lisbonDate, weighInMetrics, type MetricKey, type WeighIn } from "@/lib/weigh-in-metrics";

const number = new Intl.NumberFormat("pt-PT", { maximumFractionDigits: 2 });
const signed = new Intl.NumberFormat("pt-PT", { maximumFractionDigits: 2, signDisplay: "exceptZero" });
const percent = new Intl.NumberFormat("pt-PT", {
  style: "percent", maximumFractionDigits: 1, signDisplay: "exceptZero",
});

function relativeChange(current: number, baseline: number) {
  return baseline === 0 ? null : percent.format((current - baseline) / baseline);
}

const date = new Intl.DateTimeFormat("pt-PT", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const mainMetrics = weighInMetrics.slice(0, 4);

function displayDate(value: string) {
  return date.format(new Date(value + "T12:00:00Z"));
}

function Trend({ entries, metric }: { entries: WeighIn[]; metric: MetricKey }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const points = entries.filter(entry => entry[metric] !== null).reverse();

  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx || points.length < 2) return;
    ctx.clearRect(0,0,640,170);
    const values = points.map(row => Number(row[metric]));
    const low = Math.min(...values);
    const range = Math.max(Math.max(...values)-low,0.1);
    const dates = points.map(row => Date.parse(row.measured_on));
    const span = dates.at(-1)! - dates[0];
    const coords = values.map((value,index) => ({
      x: 18 + 604 * (span ? (dates[index]-dates[0])/span : index/(values.length-1)),
      y: 148 - 126 * (value-low)/range,
    }));
    ctx.strokeStyle = "#77705a";
    ctx.lineWidth = 1;
    for (const y of [22,85,148]) {
      ctx.beginPath(); ctx.moveTo(18,y); ctx.lineTo(622,y); ctx.stroke();
    }
    ctx.strokeStyle = "#c9a63f";
    ctx.lineWidth = 4;
    ctx.beginPath();
    coords.forEach(({x,y},i) => i === 0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y));
    ctx.stroke();
    ctx.fillStyle = "#c9a63f";
    for (const {x,y} of coords) {
      ctx.beginPath(); ctx.arc(x,y,5,0,Math.PI*2); ctx.fill();
    }
  }, [metric, points]);

  if (points.length < 2) return <p className="text-sm text-ink-500">Regista duas pesagens com este indicador para veres a evolução.</p>;
  const first = points[0];
  const last = points.at(-1)!;
  const unit = weighInMetrics.find(item => item.key === metric)?.unit;
  const initialValue = Number(first[metric]);
  const finalValue = Number(last[metric]);
  const change = relativeChange(finalValue, initialValue);
  return (
    <figure className="space-y-3">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {[
          { label: "Primeira medição", entry: first, value: initialValue },
          { label: "Última medição", entry: last, value: finalValue },
        ].map(({ label, entry, value }) => (
          <div key={label} className="rounded-lg bg-ink-900/5 p-2.5 dark:bg-white/5">
            <dt className="text-xs text-ink-500">{label}</dt>
            <dd className="text-lg font-bold tabular-nums">{number.format(value)} {unit}</dd>
            <dd className="text-xs text-ink-500">{displayDate(entry.measured_on)}</dd>
          </div>
        ))}
        <div className="col-span-2 rounded-lg bg-gold-50 p-2.5 dark:bg-gold-400/10 sm:col-span-1">
          <dt className="text-xs text-ink-500">Desde a primeira</dt>
          <dd className="text-lg font-bold tabular-nums">{change ?? "—"}</dd>
          <dd className="text-xs text-ink-500">{signed.format(finalValue - initialValue)} {metric === "fat_percent" ? "p.p." : unit}</dd>
        </div>
      </dl>
      <canvas ref={canvas} width={640} height={170} className="h-auto w-full" aria-hidden="true" />
      <figcaption className="text-xs text-ink-500">{points.length} medições de {displayDate(first.measured_on)} a {displayDate(last.measured_on)}</figcaption>
    </figure>
  );
}

export function WeighInPanel({ entries, clientId }: { entries: WeighIn[]; clientId?: string }) {
  const [metric,setMetric] = useState<MetricKey>("muscle");
  const [open,setOpen] = useState(!!clientId);
  const [fields,setFields] = useState<Record<string,string>>({ measured_on: lisbonDate() });
  const [source,setSource] = useState("manual");
  const [notice,setNotice] = useState("");
  const [reading,setReading] = useState(false);
  const [pending,startTransition] = useTransition();
  const requestId = useRef<string | undefined>(undefined);
  const latest = entries[0];
  const previous = entries[1];

  async function readFile(file: File) {
    setNotice("");
    setReading(true);
    try {
      const query = clientId ? `?cliente=${encodeURIComponent(clientId)}` : "";
      const res = await fetch(`/api/pesagens/leitura${query}`,{ method:"POST",body:file });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      const values = result.values as Record<string,string>;
      if (!weighInMetrics.some(item => values[item.key])) throw new Error("Não encontrei valores legíveis. Podes preencher os campos à mão.");
      setFields({ measured_on: "", ...values });
      requestId.current = undefined;
      setSource("starfit");
      setNotice(values.measured_on ? "Revê os valores e a data antes de guardar." : "Revê os valores e indica a data que aparece no relatório.");
    } catch (error) {
      setNotice(error instanceof Error && error.message && !(error instanceof SyntaxError)
        ? error.message : "Não foi possível ler o relatório. Podes preencher os campos à mão.");
    } finally { setReading(false); }
  }

  function submit(form: FormData) {
    requestId.current ??= crypto.randomUUID();
    form.set("id", requestId.current);
    form.set("source", source);
    startTransition(async () => {
      try {
        const result = await saveWeighIn(form);
        setNotice(result.error ?? "Pesagem guardada.");
        if (result.ok) {
          setFields({ measured_on: lisbonDate() });
          setSource("manual");
          requestId.current = undefined;
        }
      } catch { setNotice("Não foi possível guardar a pesagem."); }
    });
  }

  function renderField(item: typeof weighInMetrics[number]) {
    return (
      <label key={item.key} className="min-w-0 space-y-1 text-xs font-medium">
        <span>{item.label}{item.unit && ` (${item.unit})`}</span>
        <input name={item.key} inputMode="decimal" maxLength={6} className="input w-full"
          value={fields[item.key] ?? ""} onChange={event => {
            const value = event.target.value;
            requestId.current = undefined;
            setFields(current => ({ ...current,[item.key]:value }));
          }} />
      </label>
    );
  }

  return (
    <section className="space-y-4" aria-label="Evolução das pesagens">
      <div>
        <h2 className="font-display text-2xl font-bold">{clientId ? "Pesagens" : "A tua evolução"}</h2>
        {latest && <p className="text-sm text-ink-500">Última pesagem · {displayDate(latest.measured_on)}</p>}
      </div>
      {latest && (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {mainMetrics.map(item => {
            const value = latest[item.key];
            const before = previous?.[item.key];
            const change = value != null && before != null ? relativeChange(value, before) : null;
            return <div key={item.key} className="card min-w-0 p-3">
              <h3 className="text-xs font-semibold text-ink-500">{item.label}</h3>
              <p className="mt-1 font-display text-xl font-bold">{value === null ? "—" : `${number.format(value)} ${item.unit}`}</p>
              {value != null && before != null && <p className="mt-1 text-xs text-gold-700 dark:text-gold-300">
                <strong className="tabular-nums">{change ?? `${signed.format(value - before)} ${item.key === "fat_percent" ? "p.p." : item.unit}`}</strong> vs. anterior
              </p>}
            </div>;
          })}
        </div>
      )}
      {!open && <button type="button" className="btn-primary" onClick={() => setOpen(true)}><Plus size={16} /> Registar pesagem</button>}
      {open && <form action={submit} className="card space-y-4 p-4">
        <h3 className="font-display text-lg font-bold">Nova pesagem</h3>
        <fieldset disabled={pending || reading} className="space-y-4">
          {clientId && <input type="hidden" name="clientId" value={clientId} />}
          <label className="flex cursor-pointer flex-wrap items-center gap-2 rounded-xl border border-gold-400/40 p-3 text-sm font-semibold">
            <Camera size={17} aria-hidden="true" /> Carregar relatório Starfit
            <input type="file" accept="image/jpeg,image/png,application/pdf" className="w-full text-xs"
              onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void readFile(file); }} />
            <span className="text-xs font-normal text-ink-500">Foto JPG ou PNG, ou PDF. Até 8 MB.</span>
          </label>
          <label className="block text-sm font-medium">Data da pesagem
            <input type="date" name="measured_on" className="input mt-1 block w-full" required max={lisbonDate()}
              value={fields.measured_on} onChange={event => {
                const value = event.target.value;
                requestId.current = undefined;
                setFields(current => ({ ...current,measured_on:value }));
              }} />
          </label>
          <div className="grid grid-cols-2 gap-3">{mainMetrics.map(renderField)}</div>
          <details>
            <summary className="cursor-pointer text-sm font-semibold">Outros indicadores</summary>
            <div className="mt-3 grid grid-cols-2 gap-3">{weighInMetrics.slice(4).map(renderField)}</div>
          </details>
          {clientId && <label className="block text-sm font-medium">Nota para o cliente (opcional)
            <textarea name="note" className="input mt-1 w-full" maxLength={500} rows={2} />
          </label>}
          <button className="btn-primary w-full" type="submit">{pending ? "A guardar…" : "Guardar pesagem"}</button>
        </fieldset>
        {(reading || notice) && <p role="status" className="text-sm">{reading ? "A ler o relatório…" : notice}</p>}
      </form>}
      {latest ? <>
        <details className="card p-4">
          <summary className="cursor-pointer font-display text-lg font-bold">Evolução desde o início</summary>
          <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-1.5" aria-label="Indicador no gráfico">
            {mainMetrics.map(item => <button key={item.key} type="button" aria-pressed={metric===item.key}
              className={`rounded-full border px-2.5 py-2 text-xs ${metric===item.key ? "border-gold-400 bg-gold-50 font-semibold" : "border-current/15 text-ink-500"}`}
              onClick={() => setMetric(item.key)}>{item.label}</button>)}
          </div>
          <Trend entries={entries} metric={metric} />
          </div>
        </details>
        <div className="card divide-y divide-ink-900/10 px-4 dark:divide-white/10">
          {entries.map(entry => <details key={entry.id} className="py-3">
            <summary className="cursor-pointer text-sm font-semibold">{displayDate(entry.measured_on)} · {entry.source === "starfit" ? "Starfit" : "Registo manual"}</summary>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
              {weighInMetrics.filter(item => entry[item.key] !== null).map(item => <div key={item.key}>
                <dt className="text-ink-500">{item.label}</dt><dd className="font-semibold">{number.format(entry[item.key]!)} {item.unit}</dd>
              </div>)}
            </dl>
            {entry.note && <p className="mt-3 whitespace-pre-wrap break-words text-sm">{entry.note}</p>}
          </details>)}
        </div>
      </> : <p className="text-sm text-ink-500">Ainda não há pesagens registadas.</p>}
    </section>
  );
}
