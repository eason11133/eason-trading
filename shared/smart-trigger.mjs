const FIELD_LABELS={price:'現價',rvol:'RVOL',vwap:'VWAP',high:'當日高',low:'當日低',changePct:'漲跌幅'};
const OPS=new Set(['>=','>','<=','<','==']);

function finite(x){const n=Number(x);return Number.isFinite(n)?n:null;}
function fieldValue(snapshot,key){return snapshot?.[key];}
function compare(a,op,b){
 const x=finite(a),y=finite(b);if(x==null||y==null||!OPS.has(op))return false;
 if(op==='>=')return x>=y;if(op==='>')return x>y;if(op==='<=')return x<=y;if(op==='<')return x<y;return x===y;
}
function predicateEvidence(c,snapshot){
 const actual=fieldValue(snapshot,c.field),passed=compare(actual,c.op,c.value);
 return {field:String(c.field),op:String(c.op),target:Number(c.value),actual:finite(actual),passed,label:`${FIELD_LABELS[c.field]||c.field} ${c.op} ${c.value}${finite(actual)!=null?`（目前 ${finite(actual)}）`:''}`};
}
function evalGroup(group,snapshot,mode){
 const rows=Array.isArray(group)?group:[];
 if(!rows.length)return {present:false,passed:mode==='all',evidence:[]};
 const evidence=rows.map(c=>predicateEvidence(c,snapshot));
 return {present:true,passed:mode==='all'?evidence.every(x=>x.passed):evidence.some(x=>x.passed),evidence};
}
function invalidationRows(conditions){
 const x=conditions?.invalidation;
 if(Array.isArray(x))return {any:x};
 if(x&&typeof x==='object')return x;
 return {};
}

export function evaluateSmartTrigger(triggerOrConditions,snapshot,context={}){
 const trigger=triggerOrConditions?.conditions?triggerOrConditions:{conditions:triggerOrConditions||{}};
 const conditions=trigger.conditions||{};
 const purpose=String(trigger.purpose||'REVIEW').toUpperCase();
 const expectedVersion=trigger.playbookVersion??trigger.playbook_version??null;
 const actualVersion=context?.playbook?.version??context?.playbookVersion??null;
 const staleVersion=expectedVersion!=null&&actualVersion!=null&&String(expectedVersion)!==String(actualVersion);

 const explicitInvalid=invalidationRows(conditions);
 const invAll=evalGroup(explicitInvalid.all,snapshot,'all');
 const invAny=evalGroup(explicitInvalid.any,snapshot,'any');
 let invalidated=(invAll.present&&invAll.passed)||(invAny.present&&invAny.passed);
 const invalidationEvidence=[...invAll.evidence,...invAny.evidence].filter(x=>x.passed);
 const playbookInvalid=finite(context?.playbook?.invalid);
 if(purpose!=='INVALIDATION'&&playbookInvalid!=null&&finite(snapshot?.price)!=null&&Number(snapshot.price)<=playbookInvalid){
  invalidated=true;
  invalidationEvidence.push({field:'price',op:'<=',target:playbookInvalid,actual:Number(snapshot.price),passed:true,label:`已跌破 GPT 失效價 ${playbookInvalid}（目前 ${Number(snapshot.price)}）`,source:'playbook.invalid'});
 }

 const all=evalGroup(conditions.all,snapshot,'all');
 const any=evalGroup(conditions.any,snapshot,'any');
 const hasQualification=all.present||any.present;
 const qualificationPassed=hasQualification&&(!all.present||all.passed)&&(!any.present||any.passed);
 const blockedByInvalidation=purpose!=='INVALIDATION'&&invalidated;
 const matched=qualificationPassed&&!blockedByInvalidation&&!staleVersion;
 const passed=[...all.evidence,...any.evidence].filter(x=>x.passed);
 const failed=[...all.evidence,...any.evidence].filter(x=>!x.passed);
 const reasons=passed.map(x=>x.label);

 let summary='條件尚未成立';
 if(staleVersion)summary='策略版本已更新，舊 Trigger 不再有效';
 else if(blockedByInvalidation)summary=invalidationEvidence[0]?.label||'原策略已失效，不發送舊的進場／複判提醒';
 else if(matched)summary=reasons.slice(0,3).join(' · ')||'符合 GPT 複判條件';

 return {matched,candidateMatched:qualificationPassed,blockedByInvalidation,staleVersion,reasons,summary,evidence:{passed,failed,invalidation:invalidationEvidence,playbookVersion:{expected:expectedVersion,actual:actualVersion}}};
}

export function normalizeTriggerPolicy(policy={}){
 const minConsecutive=Math.max(1,Math.min(5,Math.trunc(Number(policy?.minConsecutive)||1)));
 const cooldownMinutes=Math.max(0,Math.min(1440,Number(policy?.cooldownMinutes)||0));
 return {oneShot:policy?.oneShot!==false,minConsecutive,cooldownMinutes};
}

// Stateful decision layer shared by the local backend and Cloudflare.
// A trigger fires on a meaningful false -> stable-true transition, not on every quote tick.
// For reusable triggers (oneShot=false), it must leave the qualifying state before it can fire again.
export function advanceSmartTrigger(trigger,snapshot,context={},at=new Date()){
 const base=evaluateSmartTrigger(trigger,snapshot,context);
 const policy=normalizeTriggerPolicy(trigger?.policy);
 const previous=trigger?.runtime&&typeof trigger.runtime==='object'?trigger.runtime:{};
 const qualified=base.matched===true;
 const streak=qualified?Number(previous.streak||0)+1:0;
 const stable=qualified&&streak>=policy.minConsecutive;
 const wasStable=previous.stable===true;
 const lastFiredMs=Date.parse(String(previous.lastFiredAt||''));
 const hasFired=Number.isFinite(lastFiredMs);
 const cooldownActive=hasFired&&policy.cooldownMinutes>0&&(at.getTime()-lastFiredMs)<policy.cooldownMinutes*60000;
 const oneShotBlocked=policy.oneShot&&hasFired;
 const transition=stable&&!wasStable;
 const deferred=stable&&previous.cooldownSuppressed===true;
 const fireCandidate=(transition||deferred)&&!oneShotBlocked;
 const matched=fireCandidate&&!cooldownActive;
 const runtime={
  ...previous,
  streak,
  stable,
  lastEvaluatedAt:at.toISOString(),
  lastCandidateMatched:base.candidateMatched===true,
  cooldownSuppressed:fireCandidate&&cooldownActive
 };
 if(!stable)runtime.cooldownSuppressed=false;
 if(matched){runtime.lastFiredAt=at.toISOString();runtime.cooldownSuppressed=false;}

 let summary=base.summary;
 if(oneShotBlocked&&stable)summary='條件仍成立，但此 Trigger 已通知過';
 else if(cooldownActive&&fireCandidate)summary='條件成立，但仍在通知冷卻時間';
 else if(stable&&wasStable&&!matched)summary='條件持續成立，已避免重複通知';
 else if(qualified&&!stable)summary=`條件成立 ${streak}/${policy.minConsecutive}，等待持續確認`;

 return {...base,matched,stable,transition,cooldownActive,oneShotBlocked,policy,runtime,summary};
}

export const SMART_TRIGGER_FIELDS=['price','rvol','vwap','high','low','changePct'];
export const SMART_TRIGGER_OPS=['>=','>','<=','<','=='];
export const SMART_TRIGGER_PURPOSES=['REVIEW','INVALIDATION','TARGET'];
function normalizePredicate(c,label='trigger condition'){
 if(!c||typeof c!=='object')throw new Error(`${label} must be an object`);
 const field=String(c.field||''),op=String(c.op||'');
 if(!SMART_TRIGGER_FIELDS.includes(field))throw new Error(`${label} field ${field} not allowed`);
 if(!SMART_TRIGGER_OPS.includes(op))throw new Error(`${label} op ${op} not allowed`);
 const value=finite(c.value);if(value==null)throw new Error(`${label} value must be a number`);
 return {field,op,value};
}
function normalizeList(value,label){return Array.isArray(value)?value.map((x,i)=>normalizePredicate(x,`${label} ${i+1}`)):[];}
export function normalizeSmartConditions(input={}){
 const all=normalizeList(input?.all,'all condition');
 const any=normalizeList(input?.any,'any condition');
 if(!all.length&&!any.length)throw new Error('trigger has no qualification conditions');
 const inv=input?.invalidation;
 const invalidation=Array.isArray(inv)?{any:normalizeList(inv,'invalidation condition')}:(inv&&typeof inv==='object'?{all:normalizeList(inv.all,'invalidation all'),any:normalizeList(inv.any,'invalidation any')}:undefined);
 return {all,...(any.length?{any}:{}),...(invalidation&&(invalidation.all.length||invalidation.any.length)?{invalidation:{...(invalidation.all.length?{all:invalidation.all}:{}),...(invalidation.any.length?{any:invalidation.any}:{})}}:{})};
}
export function normalizeSmartTriggerConfig(input={}){
 const purpose=String(input?.purpose||'REVIEW').toUpperCase();if(!SMART_TRIGGER_PURPOSES.includes(purpose))throw new Error(`invalid trigger purpose ${purpose}`);
 return {label:String(input?.label||'GPT 複判'),purpose,conditions:normalizeSmartConditions(input?.conditions||{}),policy:normalizeTriggerPolicy(input?.policy||{}),expiresAt:input?.expiresAt||null};
}
