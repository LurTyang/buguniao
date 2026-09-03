# -*- coding: utf-8 -*-
import io
p = 'app/packages/desktop/src/renderer/components/SettingsPanel.tsx'
lines = io.open(p, encoding='utf-8').read().split('\n')

# 第二份「小部件」从第二个 Section/Row 那一带开始重复。
# 找出第二次出现的 "function Hint(" 之前那个 "function Row(" 的起点
def find_all(pred):
    return [i for i, l in enumerate(lines) if pred(l)]

rows = find_all(lambda l: l.startswith('function Row({'))
hints = find_all(lambda l: l.startswith('function Hint({'))
nums = find_all(lambda l: l.startswith('function NumField({'))
print('Row at', rows, 'Hint at', hints, 'NumField at', nums)

assert len(hints) == 2 and len(nums) == 2, '不是预期的两份'

# 保留第一份 NumField（它引用了共用模块），删掉从第二个 Row/Hint 之前
# 到第二个 NumField 结束的那一整段重复
start = None
for i in range(hints[1] - 1, -1, -1):
    if lines[i].startswith('function Row({') or lines[i].startswith('function Section({'):
        start = i
        break
assert start is not None and start > nums[0], ('start', start, nums[0])
print('删除起点', start + 1, lines[start])

# 重复段一直到文件末尾（第二份 NumField 是最后一个函数）
del lines[start:]
io.open(p, 'w', encoding='utf-8', newline='').write('\n'.join(lines).rstrip('\n') + '\n')
print('ok')
