// SDK 使用演示 + “协作式单活跃” 概念演示
// 运行: node examples/demo.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createSession, renderSession, BB } from '../sdk/index.mjs';

const out = join(dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(out, { recursive: true });
const line = (t) => console.log('\n' + '─'.repeat(58) + '\n' + t);

// ============================================================
line('① 基本用法:建模 → 自绘贴图 → 渲染 → 导出');
// ============================================================
const s = createSession('java_block', { name: 'lantern' });
s.setResolution(16, 16);

const post = s.addCube({ name: 'post', from: [6, 0, 6], to: [10, 4, 10] });
const box  = s.addCube({ name: 'box',  from: [4, 4, 4], to: [12, 12, 12] });

const tex = s.addTexture({ name: 'tex', width: 16, height: 16, fill: '#5b3a1a' });
s.applyTexture(post, tex);
s.applyTexture(box, tex);

// 给灯箱四面画发光窗口
for (const face of ['north', 'east', 'south', 'west']) {
  s.paintFace(tex, box, face, (ctx, { w, h }) => {
    ctx.fillStyle = '#ffd34d';
    ctx.fillRect(w * 0.25, h * 0.2, w * 0.5, h * 0.6);
  });
}

console.log('元素:', s.elements.map(e => e.name).join(', '));
const png = renderSession(s, { angle: 'isometric', width: 360, height: 360, background: '#1b1f27' });
writeFileSync(join(out, 'lantern.png'), png);
writeFileSync(join(out, 'lantern.bbmodel'), s.exportProject());
console.log('渲染 lantern.png:', png.length, 'bytes;  导出 lantern.bbmodel');
console.log('当前全局活动项目 BB.Project.name =', BB.Project.name);

// ============================================================
line('② “协作式单活跃” 是什么');
// ============================================================
console.log(`Blockbench 引擎只有一个全局“当前项目”(裸全局 Project / BB.Project)。
所有引擎函数都读写这一个全局。所以:
 • 单活跃:任意时刻只有 1 个 session 是“活动项目”,其余只是 ModelProject.all 里的静止数据。
 • 协作式:切换靠显式调用 project.select();SDK 的 session.run() 会在每次操作前先 activate()。
   没有抢占、没有锁——靠“每个操作先激活自己”来保证正确,各操作顺序让出全局。`);

const A = createSession('free', { name: 'A' });
const B = createSession('free', { name: 'B' });
const who = () => BB.Project.name; // 当前全局活动的是谁

console.log('\n创建后,最后创建的 B 是活动项目 →  BB.Project =', who());

A.addCube({ name: 'a1', from: [0, 0, 0], to: [2, 2, 2] });
console.log('A.addCube() 内部先 select(A) →  BB.Project =', who());

B.addCube({ name: 'b1', from: [0, 0, 0], to: [4, 4, 4] });
console.log('B.addCube() 内部先 select(B) →  BB.Project =', who());

A.addCube({ name: 'a2', from: [2, 0, 0], to: [4, 2, 2] });
console.log('又对 A 操作,自动切回 A   →  BB.Project =', who());

console.log('\n结果:每个 session 各自独立,互不串扰:');
console.log('  A 元素:', A.elements.map(e => e.name).join(', '), '| active?', A.active);
console.log('  B 元素:', B.elements.map(e => e.name).join(', '), '| active?', B.active);

// ============================================================
line('③ “协作式”的边界:为什么进程内不能真并发');
// ============================================================
console.log(`因为全局只有一个,如果你绕过 SDK 直接缓存全局来用,就会踩坑:`);
A.activate();
const stale = BB.Project;              // 此刻缓存全局,指向 A
console.log('  缓存 BB.Project(此刻=A):', stale.name);
B.activate();                          // 别处切到了 B
console.log('  别处 activate(B) 后,缓存的 stale 仍指向:', stale.name, '← 已是“过期引用”');
console.log(`  → 这就是“协作式单活跃”的含义:共享一个全局、一次一个、靠主动 select 让渡。
     SDK 的 session.run() 每次操作都重新激活,所以正常用 SDK 不会错。
     要“真并发”(同时跑多个互不影响)→ 用 WorkerPool:每个子进程有自己的一套全局。`);

console.log('\n演示完成。图片在 examples/out/lantern.png');
process.exit(0);
