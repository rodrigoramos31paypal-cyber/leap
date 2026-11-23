const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
async function block(profile){const exports={};const source=ts.transpileModule(fs.readFileSync('lib/authz.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(source,{exports,require(name){if(name==='@/lib/supabase/server')return {getCurrentProfile:async()=>profile};if(name==='@/lib/mfa')return {};throw Error(name);}});return exports.pendingApprovalBlock();}
test('only approved client can pass purchase and booking guard',async()=>{assert.equal(await block({role:'client',approval_status:'approved'}),null);for(const status of ['pending','rejected',null]) assert.equal(typeof await block({role:'client',approval_status:status}),'string');});
test('blocked approved account remains blocked',async()=>assert.equal(typeof await block({role:'client',approval_status:'approved',access_blocked:true}),'string'));
