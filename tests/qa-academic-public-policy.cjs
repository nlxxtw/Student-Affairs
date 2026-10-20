'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),E=require('../academic-public-engine'),Analysis=require('../academic-public-analysis');
test('latest-attempt policy is opt-in and drives warnings, credits and statistics consistently',()=>{
 const rules={thresholds:[1,2,3,4],enabled:[true,true,true,true],scope:'term',stage:'current',rank:'original',categories:[],passScore:60,cetScore:425,degreeScore:60};
 const state={version:1,rules,courses:[{id:'c',sid:'001',term:'2025-2026-1',code:'C',name:'课程',credit:3,category:'必修'}],attempts:[{courseId:'c',type:'original',score:'80',status:'已出分',scale:'百分制',order:1},{courseId:'c',type:'retake',score:'40',status:'已出分',scale:'百分制',order:2}]},students=[{id:'001',name:'甲',dept:'学院',cls:'1班',grade:'2022'}];
 let summary=E.summarize(state,students,'2025-2026-1');assert.equal(summary.rows[0].fail,0);assert.equal(summary.rows[0].earnedCredit,3);
 rules.passResolution='latest';summary=E.summarize(state,students,'2025-2026-1');assert.equal(summary.rows[0].fail,1);assert.equal(summary.rows[0].earnedCredit,0);assert.equal(summary.rows[0].level,'黄色预警');assert.equal(summary.rows[0].details[0].stageScore,40);
 let credits=Analysis.build(summary.rows,{}).creditStats;assert.equal(credits[0].failedCredit,3);assert.equal(credits[0].earnedCredit,0);assert.equal(credits[0].category,'必修');
 summary=E.summarize(state,students,'2025-2026-1',{stage:'original'});assert.equal(summary.rows[0].fail,0);assert.equal(Analysis.build(summary.rows,{}).creditStats[0].earnedCredit,3);
 state.attempts[1].status='成绩撤回';summary=E.summarize(state,students,'2025-2026-1');assert.equal(summary.rows[0].fail,0);assert.equal(summary.rows[0].pending,1,'withdrawn latest result needs review, never reuses an earlier pass');
 assert.throws(()=>E.validateRules({...rules,passResolution:'invalid'}),/判定/);
});
