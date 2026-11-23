const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const owner='c4a7bb71-540e-4d41-ad53-c49f7085602b';
const client='00000000-0000-4000-8000-000000000001';
const other='00000000-0000-4000-8000-000000000003';
function setup({role='client',status='pending',blocked=false,request=true,trainer=null}={}) {
 const viewer={id:role==='client'?client:other,role,approval_status:status,access_blocked:blocked};
 const profiles={[client]:{id:client,role:'client',approval_status:status,full_name:'Teste'},[owner]:{id:owner,role:'owner',full_name:'PT'}};
 const db={from(table){const filters={};return {select(){return this;},eq(k,v){filters[k]=v;return this;},limit(){return this;},async maybeSingle(){
  let data=table==='profiles'?profiles[filters.id]??null:table==='leap_enrollment_requests'&&request?{client_id:client}:null;
  if(filters.role&&data?.role!==filters.role)data=null;
  return {data,error:null};
 }}}};
 const exports={};const source=ts.transpileModule(fs.readFileSync('lib/chat.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(source,{exports,require(name){if(name==='server-only')return {};if(name==='@/lib/supabase/server')return {getCurrentProfile:async()=>viewer,createAdminClient:()=>db};if(name==='@/lib/authz')return {requireStaff:async()=>viewer};if(name==='@/lib/trainer')return {getTrainerForClient:async()=>trainer};throw Error(name);}});
 return exports;
}
test('pending applicant can only open own principal PT conversation after submitting answers',async()=>{const context=await setup().chatContext();assert.equal(context.clientId,client);assert.equal(context.staffId,owner);assert.equal(context.pending,true);assert.equal(context.staff,false);});
test('pending applicant cannot choose another recipient',async()=>assert.equal(await setup().chatContext(undefined,other),null));
test('pending applicant without answers cannot use chat',async()=>assert.equal(await setup({request:false}).chatContext(),null));
test('blocked and rejected applicants cannot use chat',async()=>{assert.equal(await setup({blocked:true}).chatContext(),null);assert.equal(await setup({status:'rejected'}).chatContext(),null);});
test('owner can open pending application; unrelated trainer cannot',async()=>{assert.equal((await setup({role:'owner'}).chatContext(client)).pending,true);assert.equal(await setup({role:'trainer'}).chatContext(client),null);});
test('pending conversation cannot be associated with bookings',async()=>assert.equal(await setup().getChatBooking({pending:true},other),null));
