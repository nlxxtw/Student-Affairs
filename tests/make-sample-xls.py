import xlwt
# 单工作表：学院导入（含中文 + 数字列）
wb = xlwt.Workbook()
ws = wb.add_sheet('学院')
ws.write(0,0,'学院代码'); ws.write(0,1,'学院名称')
ws.write(1,0,85); ws.write(1,1,'信息工程学院')
ws.write(2,0,86); ws.write(2,1,'外国语学院')
ws.write(3,0,'90'); ws.write(3,1,'计算机学院')
wb.save('D:/02 AI-Codex-Projects/数智学工/数智学工数据/tests/sample-dept.xls')

# 多工作表 + 班级（更多列、含文本/空白）
wb2 = xlwt.Workbook()
s1 = wb2.add_sheet('班级')
cols = ['班级名称','年级','专业','所属学院','辅导员','班主任','学历','招生类别']
for i,c in enumerate(cols): s1.write(0,i,c)
rows = [
 ['852304通信','2024级','通信工程','信息工程学院','王老师','李老师','本科','普通本科'],
 ['852305软件','2024级','软件工程','信息工程学院','张老师','赵老师','本科','普通本科'],
]
for r,row in enumerate(rows, start=1):
    for c,v in enumerate(row): s1.write(r,c,v)
s2 = wb2.add_sheet('说明')
s2.write(0,0,'这是第二个工作表，导入应只读第一个'); s2.write(1,0,'跳过')
wb2.save('D:/02 AI-Codex-Projects/数智学工/数智学工数据/tests/sample-class.xls')
print('xls generated')
