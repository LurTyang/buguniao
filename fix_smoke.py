# -*- coding: utf-8 -*-
import io
p = 'app/packages/desktop/src/main/smoke.ts'
s = io.open(p, encoding='utf-8').read()
BT = chr(96)
bad = "    // \u26a0\ufe0f \u8fd9\u4e00\u6761\u6700\u65e9\u5199\u6210\u4e86 " + BT + "book.meta.path" + BT
good = "    // \u26a0\ufe0f \u8fd9\u4e00\u6761\u6700\u65e9\u5199\u6210\u4e86 book.meta.path"
assert bad in s, 'bad comment not found'
s = s.replace(bad, good)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
# 校验：E2E 脚本那个模板串里不许再有反引号
i = s.index('const E2E_SCRIPT = ' + BT)
j = s.index('\n' + BT, i)
body = s[i + len('const E2E_SCRIPT = ') + 1:j]
assert BT not in body, 'still has backticks: %d' % body.count(BT)
print('ok, no backticks inside the template')
