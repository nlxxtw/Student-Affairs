"use strict";

/*
 * 数智学工演示数据集。
 *
 * 约束：
 * - 所有人名、学号、联系方式和业务内容均为虚构演示信息；
 * - 不包含附件、账号、密钥、云端配置或授权信息；
 * - 记录使用稳定的 DEMO 前缀，便于人工识别与自动化验收；
 * - 由 web-server.js 在确认业务库为空后一次性写入，浏览器不能直接调用本文件。
 */

const DEMO_TERM = "2026-2027-1学期";
const DEMO_CLASS = "2026级物联网1班";
const DEMO_DEPARTMENT = "数字教育学院";
const DEMO_MAJOR = "物联网工程";

function demoRecord(value) {
  return Object.assign({ __demo: true }, value);
}

function buildDemoStudents() {
  return [
    demoRecord({
      id: "DEMO2026001", name: "张晨（演示）", gender: "男", ethnic: "汉族", political: "共青团员",
      dept: DEMO_DEPARTMENT, major: DEMO_MAJOR, grade: "2026级", cls: DEMO_CLASS, level: "本科",
      enrollType: "普通招生", enroll: "2026-09-01", graduateYear: "2030届", status: "在校",
      phone: "13800000001", source: "演示市", address: "演示路1号", counsel: "李老师（演示）",
      accom: "校内", zone: "东区", building: "敏学楼", room: "301", bed: "1",
      fund: { term: DEMO_TERM, isPoor: true, poorLevel: "一般困难", national: true, college: false, nationalMotivational: false, collegeMotivational: false, temporaryAid: false, other: "—" },
      psych: { level: "关注", issues: ["入学适应"], note: "已安排适应性谈话（演示）", updated: "2026-09-18" },
      party: { stage: "入党积极分子", leagueStatus: "共青团员", date: "2026-10-10", branch: "学生第一团支部", contact: "王老师（演示）", history: [demoRecord({ id: "DEMO-PARTY-001", stage: "入党积极分子", date: "2026-10-10", note: "演示发展记录" })] },
      classroom: [demoRecord({ id: "DEMO-CLASSROOM-001", term: DEMO_TERM, course: "大学生职业发展", category: "必修", week: "3", section: "第3-4节", type: "迟到", reason: "交通延误（演示）", result: "已完成教育提醒", teacher: "周老师（演示）", date: "2026-09-23" })],
      dorm: []
    }),
    demoRecord({
      id: "DEMO2026002", name: "李悦（演示）", gender: "女", ethnic: "汉族", political: "群众",
      dept: DEMO_DEPARTMENT, major: DEMO_MAJOR, grade: "2026级", cls: DEMO_CLASS, level: "本科",
      enrollType: "普通招生", enroll: "2026-09-01", graduateYear: "2030届", status: "在校",
      phone: "13800000002", source: "示例县", address: "示例大道2号", counsel: "李老师（演示）",
      accom: "校内", zone: "东区", building: "敏学楼", room: "302", bed: "2",
      fund: {},
      psych: { level: "正常", issues: [], note: "", updated: "2026-09-18" },
      party: { stage: "群众", leagueStatus: "非团员", history: [] },
      classroom: [],
      dorm: [demoRecord({ id: "DEMO-DORM-VIOLATION-001", term: DEMO_TERM, date: "2026-10-12", building: "敏学楼", room: "302", score: "2", reason: "晚归登记（演示）", result: "已提醒并完成宿舍安全教育" })]
    }),
    demoRecord({
      id: "DEMO2026003", name: "陈浩（演示）", gender: "男", ethnic: "汉族", political: "共青团员",
      dept: DEMO_DEPARTMENT, major: DEMO_MAJOR, grade: "2026级", cls: DEMO_CLASS, level: "本科",
      enrollType: "普通招生", enroll: "2026-09-01", graduateYear: "2030届", status: "在校",
      phone: "13800000003", source: "样例区", address: "样例街3号", counsel: "李老师（演示）",
      accom: "校内", zone: "东区", building: "敏学楼", room: "301", bed: "3",
      fund: { term: DEMO_TERM, isPoor: true, poorLevel: "比较困难", national: true, college: false, nationalMotivational: false, collegeMotivational: false, temporaryAid: true, other: "演示临时补助" },
      psych: { level: "重点", issues: ["学业压力"], note: "正在按演示闭环持续跟进", updated: "2026-10-20" },
      party: { stage: "共青团员", leagueStatus: "共青团员", history: [] },
      classroom: [], dorm: []
    })
  ];
}

function buildDemoStore() {
  const students = buildDemoStudents();
  const store = {
    nnuzc_orgs: {
      depts: [{ name: DEMO_DEPARTMENT, code: "DEMO01" }],
      majors: [{ name: DEMO_MAJOR, code: "DEMO0101", dept: DEMO_DEPARTMENT, years: "4" }],
      classes: [{ name: DEMO_CLASS, dept: DEMO_DEPARTMENT, major: DEMO_MAJOR, grade: "2026级", counselor: "李老师（演示）", teacher: "赵老师（演示）", level: "本科", enrollType: "普通招生" }],
      grades: [{ name: "2026级" }], dorms: [{ zone: "东区", building: "敏学楼" }], enrollTypes: [{ name: "普通招生" }]
    },
    nnuzc_term_list: [DEMO_TERM],
    nnuzc_current_term: DEMO_TERM,
    nnuzc_term_settings: { [DEMO_TERM]: { startDate: "2026-09-07", totalWeeks: 20 } },
    nnuzc_students: students,
    nnuzc_course_schedules: [
      demoRecord({ id: "DEMO-SCHEDULE-001", term: DEMO_TERM, cls: DEMO_CLASS, day: 1, weeks: "1-16", course: "高等数学", category: "必修", section: "第1-2节", teacher: "高老师（演示）", location: "明理楼101" }),
      demoRecord({ id: "DEMO-SCHEDULE-002", term: DEMO_TERM, cls: DEMO_CLASS, day: 3, weeks: "1-16", course: "程序设计基础", category: "实验", section: "第3-4节", teacher: "林老师（演示）", location: "实训楼302" })
    ],
    nnuzc_meetings: [demoRecord({ id: "DEMO-MEETING-001", term: DEMO_TERM, cls: DEMO_CLASS, dept: DEMO_DEPARTMENT, major: DEMO_MAJOR, grade: "2026级", topic: "新学期安全教育主题班会（演示）", date: "2026-09-08", place: "明理楼201", host: "李老师（演示）", content: "围绕校园安全、反诈与学业规划开展主题班会。", files: [], createdAt: "2026-09-08 18:00" })],
    nnuzc_talks: [demoRecord({ id: "DEMO-TALK-001", term: DEMO_TERM, sid: "DEMO2026001", name: "张晨（演示）", dept: DEMO_DEPARTMENT, major: DEMO_MAJOR, grade: "2026级", cls: DEMO_CLASS, status: "在校", date: "2026-09-18", type: "日常", way: "面谈", mood: "中", content: "了解入学适应和课程安排情况（演示）。", followUp: "两周后回访适应情况。" })],
    nnuzc_home: [demoRecord({ id: "DEMO-HOME-001", term: DEMO_TERM, sid: "DEMO2026003", name: "陈浩（演示）", dept: DEMO_DEPARTMENT, major: DEMO_MAJOR, grade: "2026级", cls: DEMO_CLASS, status: "在校", date: "2026-10-20", channel: "电话", topic: "学业状态沟通（演示）", content: "向家长介绍近期学习状态和支持方案。", result: "家校共同关注，约定下月反馈。" })],
    nnuzc_events: [demoRecord({ id: "DEMO-EVENT-001", term: DEMO_TERM, sid: "DEMO2026002", name: "李悦（演示）", dept: DEMO_DEPARTMENT, major: DEMO_MAJOR, grade: "2026级", cls: DEMO_CLASS, status: "在校", date: "2026-10-08", type: "一般事件", title: "学生身体不适处置（演示）", content: "陪同前往校医院检查并联系家长。", result: "已恢复返校，继续观察。" })],
    nnuzc_checkclass: [demoRecord({ id: "DEMO-CHECKCLASS-001", term: DEMO_TERM, date: "2026-09-23", dept: DEMO_DEPARTMENT, major: DEMO_MAJOR, grade: "2026级", cls: DEMO_CLASS, course: "程序设计基础", category: "实验", week: "3", section: "第3-4节", teacher: "林老师（演示）", location: "实训楼302", attendance: "应到30，实到29", content: "课堂秩序良好（演示）", result: "已核实1名学生请假" })],
    nnuzc_checkdorm: [demoRecord({ id: "DEMO-CHECKDORM-001", term: DEMO_TERM, date: "2026-10-12", zone: "东区", building: "敏学楼", room: "301", status: "良好", content: "卫生整洁，用电规范（演示）", result: "保持" })],
    nnuzc_help: [demoRecord({ id: "DEMO-HELP-001", term: DEMO_TERM, sid: "DEMO2026003", name: "陈浩（演示）", dept: DEMO_DEPARTMENT, major: DEMO_MAJOR, grade: "2026级", cls: DEMO_CLASS, date: "2026-10-22", type: "学业帮扶", content: "制定两周复习计划并安排朋辈辅导（演示）", result: "已开始执行" })],
    nnuzc_tasks: [],
    nnuzc_task_notes: [],
    nnuzc_keycare: [demoRecord({ id: "DEMO-CARE-001", term: DEMO_TERM, studentId: "DEMO2026003", studentName: "陈浩（演示）", level: "橙色", source: "心理预警", action: "已开展谈话并连接朋辈学业支持（演示）", nextDate: "2026-11-05", status: "跟进中", owner: "李老师（演示）", logs: [{ date: "2026-10-22 10:00", action: "建立重点关爱跟进台账（演示）", status: "跟进中" }], createdAt: "2026-10-22 10:00", updatedAt: "2026-10-22 10:00" })],
    nnuzc_workfolder: [demoRecord({ id: "DEMO-WORK-FOLDER-001", term: DEMO_TERM, type: "folder", name: "2026级物联网1班（演示资料）", parentId: "", addedAt: "2026-09-01 09:00" })],
    nnuzc_punishments: [demoRecord({ id: "DEMO-PUNISHMENT-001", type: "college", studentId: "DEMO2026002", term: DEMO_TERM, date: "2026-10-15", level: "通报批评", status: "已解除", content: "演示处分记录，用于展示台账统计。" })],
    nnuzc_dorm_dist: students.map((student) => demoRecord({ id: student.id, studentId: student.id, name: student.name, dept: student.dept, major: student.major, grade: student.grade, cls: student.cls, gender: student.gender, accom: student.accom, zone: student.zone, building: student.building, room: student.room, bed: student.bed })),
    nnuzc_dorm: { selectedZone: "东区", selectedBuilding: "敏学楼", __demo: true },
    nnuzc_dorm_spatial_v1: {
      schemaVersion: 1, settings: { defaultBedCount: 4, maxBedCount: 30 },
      rooms: [
        demoRecord({ id: "DEMO-DORM-ROOM-301", zone: "东区", building: "敏学楼", floor: "3", room: "301", bedCount: 4, status: "active", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" }),
        demoRecord({ id: "DEMO-DORM-ROOM-302", zone: "东区", building: "敏学楼", floor: "3", room: "302", bedCount: 4, status: "active", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" })
      ],
      assignments: [
        demoRecord({ id: "DEMO-DORM-ASSIGN-001", studentId: "DEMO2026001", roomId: "DEMO-DORM-ROOM-301", bedNo: "1", status: "current", source: "demo", checkInAt: "2026-09-01T00:00:00.000Z", checkOutAt: "", positionSnapshot: { zone: "东区", building: "敏学楼", floor: "3", room: "301", bed: "1" } }),
        demoRecord({ id: "DEMO-DORM-ASSIGN-002", studentId: "DEMO2026002", roomId: "DEMO-DORM-ROOM-302", bedNo: "2", status: "current", source: "demo", checkInAt: "2026-09-01T00:00:00.000Z", checkOutAt: "", positionSnapshot: { zone: "东区", building: "敏学楼", floor: "3", room: "302", bed: "2" } }),
        demoRecord({ id: "DEMO-DORM-ASSIGN-003", studentId: "DEMO2026003", roomId: "DEMO-DORM-ROOM-301", bedNo: "3", status: "current", source: "demo", checkInAt: "2026-09-01T00:00:00.000Z", checkOutAt: "", positionSnapshot: { zone: "东区", building: "敏学楼", floor: "3", room: "301", bed: "3" } })
      ],
      leaders: [demoRecord({ id: "DEMO-DORM-LEADER-001", roomId: "DEMO-DORM-ROOM-301", studentId: "DEMO2026001", role: "dorm_leader", status: "current", effectiveFrom: "2026-09-01T00:00:00.000Z", effectiveTo: "", changeReason: "演示宿舍长" })],
      audit: [], __demo: true
    },
    nnuzc_fund_terms: [{ id: 1, term: DEMO_TERM }],
    nnuzc_fund_records: [
      demoRecord({ id: "fund_DEMO2026001_2026-2027-1%E5%AD%A6%E6%9C%9F", studentId: "DEMO2026001", name: "张晨（演示）", dept: DEMO_DEPARTMENT, major: DEMO_MAJOR, grade: "2026级", cls: DEMO_CLASS, term: DEMO_TERM, isPoor: true, poorLevel: "一般困难", national: true, college: false, nationalMotivational: false, collegeMotivational: false, temporaryAid: false, other: "—", note: "演示资助记录" }),
      demoRecord({ id: "fund_DEMO2026003_2026-2027-1%E5%AD%A6%E6%9C%9F", studentId: "DEMO2026003", name: "陈浩（演示）", dept: DEMO_DEPARTMENT, major: DEMO_MAJOR, grade: "2026级", cls: DEMO_CLASS, term: DEMO_TERM, isPoor: true, poorLevel: "比较困难", national: true, college: false, nationalMotivational: false, collegeMotivational: false, temporaryAid: true, other: "演示临时补助", note: "演示临时补助" })
    ],
    nnuzc_academic_terms: [demoRecord({ id: 1, term: DEMO_TERM, status: "已录入", rows: [
      demoRecord({ _rid: "DEMO-EVAL-001", "学号": "DEMO2026001", "姓名": "张晨（演示）", "学院": DEMO_DEPARTMENT, "专业": DEMO_MAJOR, "年级": "2026级", "班级": DEMO_CLASS, "综测分数": 88.5, "排名": "5/30" }),
      demoRecord({ _rid: "DEMO-EVAL-002", "学号": "DEMO2026002", "姓名": "李悦（演示）", "学院": DEMO_DEPARTMENT, "专业": DEMO_MAJOR, "年级": "2026级", "班级": DEMO_CLASS, "综测分数": 92, "排名": "2/30" })
    ] })],
    nnuzc_academic_warnings: [demoRecord({ id: 1, term: DEMO_TERM, status: "已录入", rows: [demoRecord({ _rid: "DEMO-WARNING-001", "学号": "DEMO2026003", "姓名": "陈浩（演示）", "学院": DEMO_DEPARTMENT, "专业": DEMO_MAJOR, "年级": "2026级", "班级": DEMO_CLASS, "预警等级": "黄色", "不及格门数": "1", courses: [{ _cid: "DEMO-COURSE-001", "学号": "DEMO2026003", "姓名": "陈浩（演示）", "课程名称": "高等数学", "课程代码": "MATH1001", "成绩": "56", "学期": DEMO_TERM }] })] })],
    nnuzc_grade_terms: [demoRecord({ id: 1, term: DEMO_TERM, status: "已录入", rows: [demoRecord({ _rid: "DEMO-GRADE-001", "学号": "DEMO2026001", "姓名": "张晨（演示）", "学院": DEMO_DEPARTMENT, "专业": DEMO_MAJOR, "年级": "2026级", "班级": DEMO_CLASS, "学分加权平均分": "86.4", "平均学分绩点": "3.42", "不及格门次": "0", courses: [{ _cid: "DEMO-GRADE-COURSE-001", "学号": "DEMO2026001", "姓名": "张晨（演示）", "课程名称": "高等数学", "课程代码": "MATH1001", "总评成绩": "88", "学期": DEMO_TERM }] })] })],
    nnuzc_employment: [demoRecord({ id: "DEMO-EMPLOYMENT-001", sid: "DEMO2026001", name: "张晨（演示）", cls: DEMO_CLASS, company: "", industry: "信息技术", type: "持续跟进", employmentStatus: "持续跟进", lastContactAt: "2026-11-06", contacts: [demoRecord({ id: "DEMO-EMPLOYMENT-CONTACT-001", term: DEMO_TERM, date: "2026-11-06", method: "线下", location: "辅导员办公室（演示）", employmentStatus: "持续跟进", company: "", industry: "信息技术", content: "开展生涯规划初次访谈，了解专业兴趣与发展方向（演示）。", progress: "已形成阶段性学习与能力提升计划（演示）。", issue: "暂无", nextDate: "2026-12-06", nextPlan: "复盘阶段计划完成情况（演示）。", createdAt: "2026-11-06 15:00", updatedAt: "2026-11-06 15:00" })] })],
    nnuzc_employment_intentions: [demoRecord({ id: "DEMO-INTENTION-001", term: DEMO_TERM, sid: "DEMO2026002", name: "李悦（演示）", cls: DEMO_CLASS, intention: "拟升学-研究生", graduateSchool: "示例大学", graduateMajor: "电子信息", englishStatus: "四级通过", issues: "暂无", createdAt: "2026-10-18 10:00" })],
    nnuzc_employment_resources: [demoRecord({ id: "DEMO-EMP-RESOURCE-001", title: "示例校园招聘会", type: "招聘活动", organization: "示例就业中心", date: "2026-11-12", url: "https://example.com/demo-job", note: "演示链接" })],
    nnuzc_achievement_records: [demoRecord({ id: "DEMO-ACHIEVEMENT-001", sid: "DEMO2026001", name: "张晨（演示）", dept: DEMO_DEPARTMENT, major: DEMO_MAJOR, grade: "2026级", cls: DEMO_CLASS, category: "学科竞赛", level: "校级", awardName: "校园程序设计竞赛（演示）", prize: "一等奖", organization: "示例大学", issuingOrganization: "示例大学", date: "2026-11-20", role: "学生获奖人", teachers: "林老师（演示）", members: "", source: "manual", attachment: null, createdAt: "2026-11-20 12:00" })],
    nnuzc_award_statistics_records: [demoRecord({ id: "DEMO-AWARD-STAT-001", sid: "DEMO2026001", name: "张晨（演示）", dept: DEMO_DEPARTMENT, major: DEMO_MAJOR, grade: "2026级", cls: DEMO_CLASS, honorTitle: "优秀学生干部（演示）", competitionName: "", award: "校级", term: DEMO_TERM, schoolYear: "2026-2027学年", awardDate: "2026-12-01", certificate: null })],
    nnuzc_certificate_records: [demoRecord({ id: "DEMO-CERTIFICATE-001", folder: "DEMO2026001张晨（演示）", sid: "DEMO2026001", name: "张晨（演示）", attachment: null, data: { role: "学生获奖人", term: DEMO_TERM, category: "学科竞赛", level: "校级", awardName: "校园程序设计竞赛（演示）", prize: "一等奖", organization: "示例大学", issuingOrganization: "示例大学", date: "2026-11-20", teachers: "林老师（演示）", members: "", certificateNo: "DEMO-CERT-001", evidence: "演示识别结果" }, status: "confirmed", recognitionStatus: "done", verificationStatus: "演示", createdAt: "2026-11-20 12:00", createdBy: "演示数据", createdRole: "sa" })],
    nnuzc_other_violation_records: [demoRecord({ id: "DEMO-OTHER-VIOLATION-001", sid: "DEMO2026002", name: "李悦（演示）", dept: DEMO_DEPARTMENT, major: DEMO_MAJOR, grade: "2026级", cls: DEMO_CLASS, term: DEMO_TERM, date: "2026-10-16", type: "课堂纪律", reason: "演示违纪记录", score: "1", result: "已教育提醒", note: "仅用于功能展示" })],
    nnuzc_complaints: [demoRecord({ id: "DEMO-COMPLAINT-001", title: "自习室开放时间建议（演示）", source: "学生反馈", status: "处理中", content: "希望考试周延长开放时间。", createdAt: "2026-10-10 09:00" })],
    nnuzc_crossdept: [demoRecord({ id: "DEMO-CROSSDEPT-001", title: "协调延长自习室开放时间（演示）", department: "后勤管理部门", status: "跟进中", content: "已转交并等待反馈。", createdAt: "2026-10-10 10:00" })],
    nnuzc_ai_drafts: [demoRecord({ id: "DEMO-AI-DRAFT-001", type: "通知草稿", text: "【演示草稿】请同学们按时参加安全教育主题班会。", updated: "2026-09-07 09:00" })],
    nnuzc_custom_roster_v1: { version: 1, datasets: [{ id: "DEMO-ROSTER-001", name: "演示花名册", fields: ["id", "name", "cls", "phone"], createdAt: "2026-09-01 09:00", __demo: true }], activeId: "DEMO-ROSTER-001", __demo: true },
    nnuzc_student_org_v1: {
      orgs: [demoRecord({ id: "DEMO-ORG-001", cat: "union-u", name: "示例学生会", year: "2026-2027", termNo: 1, advisor: "王老师（演示）", status: "运行中", intro: "用于展示学生组织架构与台账。", structure: [{ id: "DEMO-ORG-NODE-001", name: "综合事务部", members: [{ sid: "DEMO2026001", name: "张晨（演示）", college: DEMO_DEPARTMENT, grade: "2026级", major: DEMO_MAJOR, cls: DEMO_CLASS, position: "干事", status: "在职", joined: "2026-09-15" }], children: [] }], atts: [], createdAt: "2026-09-01T09:00:00.000Z", updatedAt: "2026-09-01T09:00:00.000Z" })],
      activities: [demoRecord({ id: "DEMO-ORG-ACT-001", orgId: "DEMO-ORG-001", name: "迎新志愿服务（演示）", type: "志愿服务", date: "2026-09-05", place: "校园", status: "已结束", budget: 500, expense: 420 })],
      meetings: [], trainings: [],
      classrooms: [demoRecord({ id: "DEMO-ORG-CLASS-001", sid: "DEMO2026001", sname: "张晨（演示）", college: DEMO_DEPARTMENT, grade: "2026级", major: DEMO_MAJOR, cls: DEMO_CLASS, year: "2026-2027", module: "社会实践", item: "迎新志愿服务（演示）", hours: 8, credit: 0.5, status: "已认定", date: "2026-09-05" })],
      tasks: [], templates: [], years: ["2026-2027"], meta: { createdAt: "2026-09-01T09:00:00.000Z", __demo: true }, __demo: true
    }
  };
  return Object.fromEntries(Object.entries(store).map(([key, value]) => [key, JSON.stringify(value)]));
}

module.exports = {
  DEMO_TERM,
  buildDemoStore
};
