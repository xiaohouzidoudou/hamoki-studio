'use strict';
// Specialized creative briefs inspired by tnbao91/ai_asset (MIT, copyright Bao Tran 2026).
// https://github.com/tnbao91/ai_asset ; also informed by game-ui-design-workflow (MIT).
const steps=[
 {id:'document',title:'文档与页面识别'},
 {id:'style',title:'美术风格分析'},
 {id:'layout',title:'原型布局分析'},
 {id:'director',title:'美术总监创作方案'},
 {id:'generation',title:'画布生图'},
 {id:'quality',title:'视觉双重质检'}
];
const make=()=>({version:2,status:'empty',document:null,documents:[],pages:[],activePageId:null,styleDNA:'',styleLocked:false,notes:'',styleNodeIds:[],layoutImageIndex:0,analysis:{},quality:null,stages:Object.fromEntries(steps.map(x=>[x.id,'pending'])),updatedAt:new Date().toISOString()});
const stylePrompt=(notes)=>`你是专业的游戏 UI 美术风格分析师。以下图像是同一游戏项目的 STYLE 风格参考，只提取视觉设计语言，不改变游戏题材，不照搬每张图里的具体 UI 布局。
参考 tnbao91/ai_asset 的 STYLE 风格契约，用简明中文严格分节输出可跨页面复用的 Style DNA：
1 游戏类型和绘制媒介 2 颜色体系（主色、强调色、背景、金属和文字颜色；HEX 只是估算值，不要谎称像素取样）
3 按钮/面板/选中态/弹窗的材质与形状 4 图标透视与装饰 5 描边、光照、阴影与深度 6 字体与信息密度
7 必须维持的一致性规则 8 禁止的风格漂移 9 低置信度/证据不足之处。
不要猜测原图未展示的组件，无法确定时说明。
用户补充：${String(notes||'').slice(0,1700)}`;
const layoutPrompt=(doc,notes)=>`你是专业游戏 UI 交互与原型分析师。这张图是 TARGET 结构参考，目的只为识别页面元素和相对布局，不得把它的配色和低保真材质当成游戏的最终画风。
设计文档摘录：${String(doc||'').slice(0,6500)}
补充要求：${String(notes||'').slice(0,900)}
请输出 Layout Blueprint：界面名称、画布比例、布局区域、关键位置/比例、固定槽位、每区控件与数量、必须保留的文本/状态、允许美术发挥处、约束冲突和待补充信息。严禁把文档没写的设定伪装成已确认事实。对于文本示意数据和真实配置值明确区分。务必说明文档里的页面与图示是否矛盾。`;
const directorPrompt=(doc,style,layout,notes)=>`你是有丰富上线经验的游戏 UI 美术总监。用户只需提供一句目标和策划文档，由你自动反推完成高质量游戏 UI 设计的隐藏要求。
请整合下方资料，产出可以直接提交给生图模型的一张完整游戏 UI 创作方案，而不是解释文档。风格由 STYLE 决定，区域位置和控件数量由 TARGET/策划规范决定，不得错把不同素材的职责混淆。
【策划文档】\n${String(doc||'').slice(0,17500)}
【风格标准】\n${String(style||'').slice(0,8500)}
【原型布局标准】\n${String(layout||'').slice(0,8500)}
【用户额外说明】\n${String(notes||'').slice(0,1800)}
请用中文输出以下段落：
「页面清单」依据文档列出各页，区分有原型/无原型；设计第一张界面应优先选有明确布局的。
「设计理解」交代用户目标、文档明确要求与基于经验的 AI 假设，列出冲突及不确定处。
「最终生图提示词」以一段详细完整的自然语言描述目标页面、确定的 UI 布局顺序和固定位置、风格基因、按钮和组件、材质、色彩、层次、具体禁忌；突出同时遵循 STYLE 与 TARGET。不能编造策划未规定的业务数值。
「质检清单」分别给出风格和布局检查条目。
内容适合一张完整界面，不要输出 Unity、拆图、代码。不能保证文字生成精确时，请提示最终文案需人校对。`;
const qualityPrompt=(doc,style,layout)=>`你是独立的游戏 UI 视觉质检员。三张图按顺序是【已确认 STYLE 风格参考】、【策划原型 TARGET】、【生图结果】。请真正观察图片，再结合以下标准分别审核。
【风格基因】${String(style||'').slice(0,4500)}
【原型布局】${String(layout||'').slice(0,4500)}
【文档相关约束】${String(doc||'').slice(0,2300)}
先列出观察到的事实。然后分别给出：风格一致性、原型布局遵循、必须控件/信息完整性、文字错漏、明显视觉缺陷。
每个问题写明位置、证据和具体修改办法；无法看清就标注无法判定，不允许凭空给出通过结论。最后以『建议：可提交人工审核/建议返工』结尾，并给出一条合并后的返工提示词。视觉质检是辅助判断，最终由用户决定。`;
function extractPrompt(value){
 const text=String(value||'');const match=text.match(/(?:^|\n)[#*\s]*[「【]?最终生图提示词[」】]?\s*[:：]?\s*\n?([\s\S]*?)(?=\n[#*\s]*[「【]?质检清单[」】]?|$)/);
 return (match?.[1]||text).trim().slice(0,11500);
}
module.exports={steps,make,stylePrompt,layoutPrompt,directorPrompt,qualityPrompt,extractPrompt};
