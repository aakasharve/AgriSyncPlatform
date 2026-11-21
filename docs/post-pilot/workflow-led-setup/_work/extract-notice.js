const fs=require('fs');
const REPO='E:/APPS/Running App Versions/AgriSyncPlatform/.claude/worktrees/plr-d10-ui-9a-4636d5/src/clients/mobile-web/src';
const s=fs.readFileSync(REPO+'/features/consent/gate/consentNotice.ts','utf8');
const v=fs.readFileSync(REPO+'/i18n/voiceSwitchWords.ts','utf8');
const g=(re)=>{const m=v.match(re); return m[1]};
const PROOF_KEPT_MR=g(/PROOF_KEPT_MR = '([^']*)'/);
const OFF_CONSEQUENCE_MR=g(/OFF_CONSEQUENCE_MR = '([^']*)'/);
let block=s.slice(s.indexOf('const mr: NoticeCopy = {')+'const mr: NoticeCopy = '.length, s.indexOf('// ── English'));
block=block.trim().replace(/;\s*$/,'');
const mr=new Function('PROOF_KEPT_MR','OFF_CONSEQUENCE_MR','return ('+block+')')(PROOF_KEPT_MR,OFF_CONSEQUENCE_MR);
const fid=s.match(/legalName: '([^']*)'/)[1], contact=s.match(/contact: '([^']*)'/)[1];
const out={title:mr.title,intro:mr.intro,brandLine:mr.brandLine,purposeCardsHeading:mr.purposeCardsHeading,
 cards:mr.cards.map(c=>({id:c.id,title:c.title,data:c.data,purpose:c.purpose})),willNotDo:mr.willNotDo,processors:mr.processors,
 rights:mr.rights,entity:mr.entity,acceptanceMeaning:mr.acceptanceMeaning,tick:mr.tick,ctaDisabledHint:mr.ctaDisabledHint,links:mr.links,legalName:fid,contact};
fs.writeFileSync('_work/src/notice.json',JSON.stringify(out,null,1),'utf8');
let words=0; const walk=(o)=>{ if(typeof o==='string') words+=o.trim().split(/\s+/).length; else if(Array.isArray(o)) o.forEach(walk); else if(o&&typeof o==='object') Object.entries(o).forEach(([k,x])=>{ if(k!=='id') walk(x)}) };
walk([out.title,out.intro,out.brandLine,out.purposeCardsHeading,out.cards,out.willNotDo,out.processors,out.rights,out.entity,out.acceptanceMeaning,out.tick,out.ctaDisabledHint,out.links]);
console.log('ok words(approx, all fields)=',words, 'keys',Object.keys(out).length);
