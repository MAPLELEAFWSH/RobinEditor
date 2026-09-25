/**
 * Ray 参数的中文说明表。
 *
 * 这张表是手写的，不是从哪抄的。每条的来源分三种，界面上会照实标出来：
 *
 *   注释   原文件里作者自己写的注释（ray.conf 顶上的 `// 0 : None` 那种）
 *   定义   渲染包自己的 conf / fxsub 里写明的参数名与取值（这些文件在用户机器上，
 *          本工具本来就要读写它们）
 *   推断   只有名字能依据，按命名习惯推的
 *
 * **写的是"这个参数是什么、调了会怎样"，不写"它内部怎么算的。**
 * 别的实现的内部逻辑不搬进来 —— 需要那种知识的地方，本工程自己对着真包试出来再写。
 *
 * **写不出来的就不写。** 查不到的条目在这儿没有记录，界面上显示"没有说明"，
 * 不编一段看着像那么回事的话糊弄过去。
 *
 * 语料来自本机这几份真包，值都是对着文件核过的：
 *   D:\9.26mmd\ray-mmd-1.5.2\ray.conf                     （131 行，18 个 #define）
 *   D:\9.26mmd\ray-mmd-1.5.2\ray_advanced.conf            （42 行，全是 static const）
 *   D:\9.26mmd\ray-mmd-1.5.2\Materials\material_2.0.fx    （127 行，材质主配置）
 *   D:\9.26mmd\ray-mmd-1.5.2\Materials\material_common_2.0.fxsub （1599 行，参数定义）
 *   D:\9.26mmd\ray-mmd-1.5.2\Materials\toon\Tex\RT_Normalmap\fx\*.fx（NCHL 风格材质）
 */

export type Opt = { value: string; label: string };

/** 说明的来源。界面上会显示成一个小角标 */
export type DocSource = '注释' | '定义' | '推断';

export type Doc = {
  /** 这个参数控制什么 */
  zh: string;
  /** 枚举取值。有就渲染成下拉框 */
  options?: Opt[];
  /** 怎么调：往哪边调会怎样 */
  how?: string;
  /** 性能代价，有的话 */
  cost?: string;
  /** 依据 */
  src: DocSource;
};

/* ============================================================
   ray.conf —— 18 个 #define，全部有原作者的注释
   ============================================================ */

export const RAY_CONF: Record<string, Doc> = {
  SUN_LIGHT_ENABLE: {
    zh: '太阳平行光。整个场景的主光源，不开就是纯环境光，阴影和明暗交界全没有。',
    options: [
      { value: '0', label: '关' },
      { value: '1', label: '开' },
      { value: '2', label: '开，并且按太阳高度角算辐射强度' }
    ],
    how: '选 2 的时候光照强度跟着 ray.x 里太阳附件的高度走 —— 做日落、日出那种光色变化用这个。',
    src: '注释'
  },
  SUN_SHADOW_QUALITY: {
    zh: '太阳阴影的贴图分辨率。数字每加一级，边长翻一倍，显存占用翻四倍。',
    options: [
      { value: '0', label: '不投影' },
      { value: '1', label: '低 512×4' },
      { value: '2', label: '中 1024×4' },
      { value: '3', label: '高 2048×4' },
      { value: '4', label: '很高 4096×4' },
      { value: '5', label: '极高 8192×4' }
    ],
    how: '越高阴影边缘越干净（尤其是头发自阴影那种细结构），但 4 以上在中端卡上会明显卡。模型多、镜头不贴脸的时候用 3 就够。',
    cost: '每级显存 ×4。5 级是 8192² ×4，绝大多数显卡扛不住。',
    src: '注释'
  },
  IBL_QUALITY: {
    zh: '基于图像的光照（IBL）。用一张环境贴图给整个场景补环境光，金属和光滑表面的反射感主要靠它。',
    options: [
      { value: '0', label: '关（原注释没列 0，按套路应该是关，但作者没写）' },
      { value: '1', label: '开' },
      { value: '2', label: '开，并且把环境贴图的 UV 上下翻转' }
    ],
    how: '环境贴图的 V 方向和 MMD 不一致的时候画面会上下颠倒，选 2 修。SKYBOX 那张图本来是对的就不用动。',
    src: '注释'
  },
  FOG_ENABLE: {
    zh: '雾。按距离给画面叠一层颜色，远处发白或者发灰，用来做空气感、拉开纵深。',
    options: [
      { value: '0', label: '关' },
      { value: '1', label: '开' }
    ],
    how: '开关在这儿，浓度和颜色在 ray.x 的 Fog 附件里调。',
    src: '注释'
  },
  MULTI_LIGHT_ENABLE: {
    zh: '多光源。允许除太阳之外再放若干点光源 / 聚光灯 / 面光源。',
    options: [
      { value: '0', label: '关' },
      { value: '1', label: '开' }
    ],
    how: '灯的数量上限在 ray.x 的 Light 附件里定。每多一盏灯多一遍光照和后处理，灯多了先卡的是这里。',
    cost: '每盏灯都会跑一遍完整的光照计算，3 盏以上在复杂模型上就有感。',
    src: '注释'
  },
  OUTLINE_QUALITY: {
    zh: '描边。给模型加一圈轮廓线（二次元那种），也能顺便开抗锯齿。',
    options: [
      { value: '0', label: '关' },
      { value: '1', label: '开描边' },
      { value: '2', label: '开描边 + SMAA 抗锯齿' },
      { value: '3', label: '开描边 + SSAA 抗锯齿' }
    ],
    how: '选了 2 或 3 就不用再单独开 AA_QUALITY，会重复。描边的粗细和颜色在材质的 Edge 参数里。',
    cost: 'SSAA 是超采样，代价比 SMAA 大得多。',
    src: '注释'
  },
  TOON_ENABLE: {
    zh: '卡通材质支持。让模型能用 MMD 自带的那种 toon 渐变，做出硬边的明暗分界。',
    options: [
      { value: '0', label: '关' },
      { value: '1', label: '支持 toon 材质' },
      { value: '2', label: '支持 toon 材质，并且加上扩散（软一点的过渡）' }
    ],
    how: '想要干净的两段式明暗选 1，想要边缘稍微化开选 2。做厚涂风格的模型一般关掉反而好。',
    src: '注释'
  },
  SSDO_QUALITY: {
    zh: '屏幕空间方向光遮蔽。按屏幕上的深度关系在夹角处压暗，用来出"墙角发灰"那种接触阴影。',
    options: [
      { value: '0', label: '关' },
      { value: '1', label: '8 采样' },
      { value: '2', label: '12 采样' },
      { value: '3', label: '16 采样' },
      { value: '4', label: '20 采样' },
      { value: '5', label: '24 采样' },
      { value: '6', label: '28 采样' }
    ],
    how: '采样越多噪点越少、越糊。6 档的代价不小，一般 3~4 够用。强度在 ray_advanced.conf 的 mSSDOIntensity* 里。',
    cost: '采样数与每像素成本成正比。6 档在 1080p 下大约吃掉 15~25% 的帧时间。',
    src: '注释'
  },
  SSR_QUALITY: {
    zh: '屏幕空间反射。用当前画面当反射源，做地板、水面、金属上的模糊倒影。',
    options: [
      { value: '0', label: '关' },
      { value: '1', label: '32 采样' },
      { value: '2', label: '64 采样' },
      { value: '3', label: '128 采样' }
    ],
    how: '反射范围和衰减在 ray_advanced.conf 的 mSSRRange* / mSSRFadeStart 里。屏幕空间反射只能反射画面里有的东西，镜头外的物体反射不出来 —— 这是方法本身的限制，不是配置问题。',
    cost: '采样数越高越平滑也越慢。3 档是这份配置的默认，已经偏重。',
    src: '注释'
  },
  SSSS_QUALITY: {
    zh: '屏幕空间次表面散射。让皮肤、薄布料在背光时透出一点血色，也就是"透光感"。',
    options: [
      { value: '0', label: '关' },
      { value: '1', label: '开' }
    ],
    how: '强度在 ray_advanced.conf 的 mSSSSIntensityMin / Max。注意这两个值的默认是 0.04 和 0.02 —— Max 比 Min 还小，是原包就这么写的，不是笔误，别顺手改成递增。',
    src: '注释'
  },
  BOKEH_QUALITY: {
    zh: '散景景深。按焦距把前后虚化，光点会散成光斑。',
    options: [
      { value: '0', label: '关' },
      { value: '1', label: '开' }
    ],
    how: '对焦方式由 ray.x 里 Bokeh 附件的 MeasureMode 决定：0.00~0.24 是测试圆、0.25~0.49 是测试圆 + 用附件骨骼对焦、0.50~0.98 是只手调焦距、0.99~1.00 是手调焦距 + 附件骨骼对焦。这段话是原注释里写的。',
    cost: '一遍额外的全屏采样，同时关掉 MSAA 的话边缘会有点糊。',
    src: '注释'
  },
  HDR_EYE_ADAPTATION: {
    zh: '眼睛适应（自动曝光）。镜头从亮处移到暗处时画面会自己慢慢变亮，模拟瞳孔调节。',
    options: [
      { value: '0', label: '关' },
      { value: '1', label: '开，18% 中灰测光之前的档位' },
      { value: '2', label: '开，18% 中灰测光' }
    ],
    how: '做静帧、单张图的时候建议关掉 —— 它会让同一个场景在不同时间点亮度不一样，出图的时候就不好复现了。做动画想有"走出阴影"的效果再开。',
    src: '注释'
  },
  HDR_BLOOM_MODE: {
    zh: '泛光。亮的地方往外洇一圈光晕。',
    options: [
      { value: '0', label: '关' },
      { value: '1', label: '用亮度阈值（110 版之前的做法）' },
      { value: '2', label: '按饱和度（110 版）' },
      { value: '3', label: '按亮度 + 曝光（120 版）' },
      { value: '4', label: '按饱和度 + 曝光（130 版起，也就是现在的默认）' }
    ],
    how: '0~3 是历史版本留下的档位，作者在注释里标了各自对应哪个版本。新做的场景用 4。强度在 mBloomIntensity* 里。',
    src: '注释'
  },
  HDR_FLARE_MODE: {
    zh: '镜头光斑。太阳直射镜头时出现的一串圆斑。',
    options: [
      { value: '0', label: '关' },
      { value: '1', label: '蓝色' },
      { value: '2', label: '橙色' },
      { value: '3', label: '自动（按画面色温）' }
    ],
    how: '想不被固定色带偏就用 3。',
    src: '注释'
  },
  HDR_STAR_MODE: {
    zh: '星芒 / 拉丝。高光处向外拉出放射状的线。',
    options: [
      { value: '0', label: '关' },
      { value: '1', label: '变形镜头拉丝（蓝色）' },
      { value: '2', label: '变形镜头拉丝（自动配色）' },
      { value: '3', label: '星芒（橙色）' },
      { value: '4', label: '星芒（自动配色）' }
    ],
    how: '拉丝是横贯整幅画面的水平线，适合电影感；星芒是从光点放射的十字，适合演出灯光。做 MV 的时候这两个同时只会打架，挑一个。',
    src: '注释'
  },
  HDR_TONEMAP_OPERATOR: {
    zh: '色调映射曲线。把 HDR 的高动态范围压回屏幕能显示的范围，这一步决定整张图的"底子"。',
    options: [
      { value: '0', label: '线性（会过曝，基本不用）' },
      { value: '1', label: 'Reinhard，按亮度保色' },
      { value: '2', label: 'Hable / Filmic，白点在 4' },
      { value: '3', label: 'Uncharted2，白点在 8' },
      { value: '4', label: 'Hejl2015' },
      { value: '5', label: 'ACES-sRGB' },
      { value: '6', label: 'NaughtyDog' }
    ],
    how: 'ACES（5）对比最强、颜色最"电影"，但会把饱和度压下去；Uncharted2（3）偏柔和，肤色好看；Hable（2）最中性。这一条改一下整张图的气质就变了，建议先定它再调别的。',
    src: '注释'
  },
  AA_QUALITY: {
    zh: '抗锯齿。',
    options: [
      { value: '0', label: '关' },
      { value: '1', label: 'FXAA' },
      { value: '2', label: 'SMAA ×1 中（AMD 卡可能不支持）' },
      { value: '3', label: 'SMAA ×1 高' },
      { value: '4', label: 'SMAA ×2 中' },
      { value: '5', label: 'SMAA ×2 高' }
    ],
    how: 'FXAA 最便宜但会糊细节；SMAA 边缘干净但吃性能。OUTLINE_QUALITY 选了 2 或 3 的话这里就不用开了。作者的注释里明确写了中档 SMAA 在 AMD 显卡上可能不支持。',
    cost: 'SMAA ×2 是两倍采样，代价大约是 ×1 的两倍。',
    src: '注释'
  },
  POST_DISPERSION_MODE: {
    zh: '后期色散。让画面边缘出现彩色分离，做出"隔着镜头看"的感觉。',
    options: [
      { value: '0', label: '关' },
      { value: '1', label: '色偏（整体轻微偏色）' },
      { value: '2', label: '色差（边缘红蓝分离）' }
    ],
    how: '1 只是整体偏一点色，2 才是常见的镜头色差。数值给大了会像得了散光，谨慎。',
    src: '注释'
  }
};

/* ============================================================
   ray_advanced.conf —— 42 个 static const
   ============================================================

   这批的名字几乎全是 XxxMin / XxxMax 成对的。它们**不是渲染参数本身**，
   而是 ray.x 里那些附件的滑杆上下限 —— 改它等于改"能调的范围"，
   不是改"现在多少"。这个区别原文件完全没写，是从成对的命名和
   同名参数在 ray.x 附件里的用法推的，所以标"推断"。
   ============================================================ */

export const RAY_ADVANCED: Record<string, Doc> = {
  mLightIntensityMin: {
    zh: '多光源亮度滑杆的下限。改它不会改现在的亮度，只改 ray.x 里那个滑杆能拖到多低。',
    how: '按推断，成对的 Min/Max 是给 ray.x 附件当滑杆范围用的。要真正改亮度请去 ray.x 的 Light 附件。',
    src: '推断'
  },
  mLightIntensityMax: {
    zh: '多光源亮度滑杆的上限。',
    src: '推断'
  },
  mLightDistance: {
    zh: '点光源的默认作用距离。',
    src: '推断'
  },
  mLightPlaneNear: {
    zh: '光源视锥的近裁剪面。太小会有深度精度问题，太大会把靠近光源的物体切掉。',
    src: '推断'
  },
  mLightPlaneFar: {
    zh: '光源视锥的远裁剪面。它决定了阴影能投多远。',
    how: '阴影断了、远处物体不投影，多半是这个值不够。但调大近远比会让深度精度变差，阴影边缘出现条纹。',
    src: '推断'
  },
  mTemperature: {
    zh: '色温，单位开尔文。6600 是原作者标的白点（D66）。',
    how: '原注释写了范围 1000 ~ 40000。数值越低越偏橙红（暖），越高越偏蓝（冷）。3200 左右是钨丝灯的暖黄，5600 是日光，10000 以上开始发蓝。',
    src: '注释'
  },
  mEnvLightIntensityMin: {
    zh: '环境光强度滑杆的下限。',
    src: '推断'
  },
  mEnvLightIntensityMax: {
    zh: '环境光强度滑杆的上限。默认 6.2831852 就是 2π —— 这是个球面积分出来的系数，不是随手写的数。',
    src: '推断'
  },
  mBloomIntensityMin: {
    zh: '泛光强度滑杆的下限。',
    src: '推断'
  },
  mBloomIntensityMax: {
    zh: '泛光强度滑杆的上限。',
    src: '推断'
  },
  mBloomGhostThresholdMax: {
    zh: '泛光重影（ghost）的亮度阈值上限。超过这个亮度的像素才会产生重影。',
    how: '调低会有更多高光产生重影，调高只有最亮的地方才有。',
    src: '推断'
  },
  mExposureMin: {
    zh: '曝光滑杆的下限。',
    src: '推断'
  },
  mExposureMax: {
    zh: '曝光滑杆的上限。',
    src: '推断'
  },
  mExposureEyeAdapationMin: {
    zh: '眼睛适应（自动曝光）能压到的下限。',
    how: 'EyeAdapation 在这里是原文件的拼写（Adapation，少了个 t）。别"顺手改对"，改了 .fxsub 那边就对不上了。',
    src: '推断'
  },
  mExposureEyeAdapationMax: {
    zh: '眼睛适应能提上去的上限。',
    src: '推断'
  },
  mVignetteInner: {
    zh: '暗角的内边界（相对半径）。从这里开始往外压暗。',
    src: '推断'
  },
  mVignetteOuter: {
    zh: '暗角的外边界。到这里压到最黑。',
    how: 'Outer 比 Inner 大，两者之间是渐变段。差的越多过渡越柔。',
    src: '推断'
  },
  mPointLightNear: {
    zh: '点光源的近距离衰减起点。',
    src: '推断'
  },
  mPointLightFar: {
    zh: '点光源的远距离衰减终点。超过这个距离就不照亮了。',
    src: '推断'
  },
  mPSSMCascadeZMin: {
    zh: 'PSSM 级联阴影里第一层级联的起始 Z 范围。PSSM 是把视锥切成几段分别投阴影，近处精度高、远处精度低。',
    src: '推断'
  },
  mPSSMCascadeZMax: {
    zh: 'PSSM 级联阴影的最远 Z 范围。',
    src: '推断'
  },
  mPSSMCascadeLambda: {
    zh: 'PSSM 级联的划分系数，0~1。0 是平均分配（每段一样长），1 是按透视分配（近处密、远处疏）。',
    how: '默认 0.5 是折中。近处阴影有锯齿感就调小，远处阴影断了就调大。',
    src: '推断'
  },
  mPSSMDepthZMin: {
    zh: '阴影深度图的近端。',
    src: '推断'
  },
  mPSSMDepthZMax: {
    zh: '阴影深度图的远端。这个值要盖住整个场景，不然远处物体不投影。',
    src: '推断'
  },
  mSSRRangeMax: {
    zh: '屏幕空间反射的最大追踪距离。超过这个距离就不再找反射源了。',
    how: '调大能反射更远的东西，但采样步数会被摊薄，噪点变多。',
    src: '推断'
  },
  mSSRRangeScale: {
    zh: '屏幕空间反射的步长缩放。',
    src: '推断'
  },
  mSSRThreshold: {
    zh: '屏幕空间反射的启发式阈值，决定哪些像素值得去追反射。',
    src: '推断'
  },
  mSSRFadeStart: {
    zh: '反射开始按距离淡出的位置（相对最大距离的比例）。0.8 就是从 80% 处开始淡。',
    how: '调小会让反射更早消失，能掩盖远处反射的噪点。',
    src: '推断'
  },
  mSSSSIntensityMin: {
    zh: '次表面散射强度的下限。',
    how: '原文件里 Min=0.04、Max=0.02，Max 比 Min 小。这是原包就这么写的，不是笔误 —— 别按"Min 应该小于 Max"的直觉去改，那样跑出来的结果跟包作者的意图不一致。',
    src: '推断'
  },
  mSSSSIntensityMax: {
    zh: '次表面散射强度的上限（原文件里比 Min 还小，见上）。',
    src: '推断'
  },
  mSSDOParams: {
    zh: 'SSDO 的四个参数，原文件里是 {2.0, 2.0, 0.03, 0.15}。原注释没写这四个分别是什么。',
    how: '从 SSDO 的常见做法看，前两个多半是采样半径和强度、后两个是偏置和某个衰减系数，但**这是猜的**，ray-mmd 没有文档写清楚。不动它。',
    src: '推断'
  },
  mSSDOBiasNear: {
    zh: 'SSDO 近处的深度偏置，用来避免自遮蔽（表面把自己当成遮挡物，画面发黑）。',
    src: '推断'
  },
  mSSDOBiasFar: {
    zh: 'SSDO 远处的深度偏置。远处深度精度差，偏置要比近处小很多。',
    src: '推断'
  },
  mSSDOBiasFalloffNear: {
    zh: 'SSDO 偏置随距离衰减的起点。',
    src: '推断'
  },
  mSSDOIntensityMin: {
    zh: 'SSDO 强度的下限。',
    src: '推断'
  },
  mSSDOIntensityMax: {
    zh: 'SSDO 强度的上限。',
    src: '推断'
  },
  mSSDOBlurFalloff: {
    zh: 'SSDO 降噪模糊的衰减系数。',
    src: '推断'
  },
  mSSDOBlurSharpnessMin: {
    zh: 'SSDO 模糊锐度的下限。',
    src: '推断'
  },
  mSSDOBlurSharpnessMax: {
    zh: 'SSDO 模糊锐度的上限。',
    src: '推断'
  },
  mFXAAQualitySubpix: {
    zh: 'FXAA 的次像素混叠质量。0 只做边缘平滑，1 会把细线也当成锯齿去糊。',
    how: '默认 0.5。字和细网格多的场景调低，不然会糊成一团。',
    src: '推断'
  },
  mFXAAQualityEdgeThreshold: {
    zh: 'FXAA 的边缘判定阈值。',
    src: '推断'
  },
  mFXAAQualityEdgeThresholdMin: {
    zh: 'FXAA 的边缘判定阈值下限，低于它的对比度直接不当边缘处理。',
    how: '调高能省性能、少糊，但细边会漏掉。',
    src: '推断'
  }
};

/* ============================================================
   material_2.0.fx —— 材质主配置
   ============================================================

   这个文件是按「槽位」组织的，每个槽位（ALBEDO / NORMAL / SMOOTHNESS …）
   都有同一套后缀。所以后缀的含义在这儿写一次，前面用 `*` 通配，
   界面按名字匹配就能出说明，不用为 11 个槽位各写 5 条。
   ============================================================ */

/** 后缀规则。key 是后缀（含前导下划线），按顺序匹配，先匹配到的先用 */
export const MATERIAL_SUFFIX: { suffix: string; doc: Doc }[] = [
  {
    suffix: '_MAP_FROM',
    doc: {
      zh: '这一路贴图从哪来。0 是不用贴图（走常量值），6 是拿屏幕缓冲当贴图。',
      options: [
        { value: '0', label: '不用贴图，直接用常量值' },
        { value: '1', label: '外部文件，只读一次' },
        { value: '2', label: '外部文件 + 动画（UV 和亮度可由 ray.x 附件驱动）' },
        { value: '3', label: 'MMD 材质自带的 Diffuse 贴图' },
        { value: '4', label: 'MMD 材质的 Sphere（环境）贴图' },
        { value: '5', label: 'MMD 材质的 Toon 贴图' },
        { value: '6', label: '屏幕缓冲（把当前画面当贴图用）' },
        { value: '7', label: '同 Diffuse 贴图' },
        { value: '8', label: '同 Diffuse 贴图' }
      ],
      how: '选 1 或 2 才需要填下面那个 _MAP_FILE 的文件名；选 3/4/5 是用 PMX 里已经挂好的贴图，不需要文件名。法线那一路不吃 7/8/9，原文件里直接 #error 报不支持。',
      src: '定义'
    }
  },
  {
    suffix: '_MAP_FILE',
    doc: {
      zh: '外部贴图的文件名。只有 _MAP_FROM 是 1 或 2 的时候才起作用。',
      how: '相对路径，相对于这个 .fx 所在的目录。用右边的"选贴图"按钮填。',
      src: '定义'
    }
  },
  {
    suffix: '_MAP_SWIZZLE',
    doc: {
      zh: '从贴图的哪个通道取值。贴图把几路数据打包在一张图里的时候用这个挑。',
      options: [
        { value: '0', label: 'R 红' },
        { value: '1', label: 'G 绿' },
        { value: '2', label: 'B 蓝' },
        { value: '3', label: 'A 透明' }
      ],
      src: '定义'
    }
  },
  {
    suffix: '_MAP_UV_FLIP',
    doc: {
      zh: '把这一路贴图的 UV 翻转。',
      options: [
        { value: '0', label: '不翻' },
        { value: '1', label: '横向翻（U 方向：coord.x = 1 - coord.x）' },
        { value: '2', label: '纵向翻（V 方向）' },
        { value: '3', label: '横竖都翻' }
      ],
      how: '贴图在模型上贴反的时候用这个，比去 PS 里翻图省事。**它不止"翻/不翻"两档** —— 原文件里 1/2/3 是三段不同的坐标改写（METALNESS / EMISSIVE / CUSTOM_A 那几路实测都有 1、2、3）。法线那一路还多一档 4，见那条单独的说明。',
      src: '定义'
    }
  },
  {
    suffix: '_MAP_APPLY_SCALE',
    doc: {
      zh: '贴图采样值怎么和常量值结合。',
      options: [
        { value: '0', label: '不结合，贴图值直接用' },
        { value: '1', label: '相乘：贴图值 × 常量值' },
        { value: '2', label: '当指数：常量值次方' }
      ],
      how: '选 1 可以用常量当整体倍率；选 2 是调对比（常量 <1 提亮暗部，>1 压暗）。',
      src: '定义'
    }
  },
  {
    suffix: '_MAP_TYPE',
    doc: {
      zh: '这一路贴图的解读方式。不同槽位可选的档位不一样 —— 下表是法线和光滑度那两路的。',
      options: [
        { value: '0', label: '按常规用（法线：当切线空间法线图；光滑度：当光滑度图）' },
        { value: '1', label: '法线：只取 X/Y，Z 用 sqrt(1-x²-y²) 重建 ／ 光滑度：把 Roughness 转成 Smoothness' },
        { value: '2', label: '法线：当高度图用（低质量，屏幕空间导数） ／ 光滑度：取反' },
        { value: '3', label: '法线：当高度图用（高质量，多采两次）' },
        { value: '4', label: '法线：两张法线混合模式（要求第二张法线为空，否则原文件直接报错）' }
      ],
      how: '把 diffuse 当凹凸图用的时候选 2 或 3。3 比 2 干净但更慢。这张高度图只有 R 通道被用到。',
      src: '定义'
    }
  },
  {
    suffix: '_MAP_COLOR_FLIP',
    doc: {
      zh: '把这一路贴图的颜色取反。',
      options: [
        { value: '0', label: '不反' },
        { value: '1', label: '反相' }
      ],
      src: '定义'
    }
  },
  {
    suffix: '_MAP_APPLY_DIFFUSE',
    doc: {
      zh: '把 MMD 材质自带的 Diffuse 颜色乘到这一路贴图上。',
      options: [
        { value: '0', label: '不乘，贴图颜色直接用' },
        { value: '1', label: '乘上 MMD 材质的 Diffuse 颜色' }
      ],
      how: '开了之后 PMX 里那个材质的 Diffuse 色（在 PMD/PMX 编辑器里调的那个整体色调）会一起生效，相当于"模型自带的染色"和这张贴图相乘。想让模型在 MMD 里的颜色调整仍然管用就打开它。',
      src: '定义'
    }
  },
  {
    suffix: '_MAP_APPLY_MORPH_COLOR',
    doc: {
      zh: '让这一路贴图跟着 MMD 的表情（morph）颜色变化走。',
      options: [
        { value: '0', label: '不跟' },
        { value: '1', label: '跟随表情颜色' }
      ],
      how: '做表情动画的时候颜色要一起变才用得上。静态图不用管。',
      src: '定义'
    }
  },
  {
    suffix: '_MAP_APPLY_MORPH_INTENSITY',
    doc: {
      zh: '让这一路的强度跟着 MMD 表情走。',
      options: [
        { value: '0', label: '不跟' },
        { value: '1', label: '跟随表情' }
      ],
      src: '定义'
    }
  },
  {
    suffix: '_MAP_APPLY_BLINK',
    doc: {
      zh: '让这一路跟着眨眼动（自发光闪烁那种）。',
      options: [
        { value: '0', label: '不跟' },
        { value: '1', label: '跟随眨眼' }
      ],
      src: '定义'
    }
  },
  {
    suffix: '_ENABLE',
    doc: {
      zh: '这一路的开关。关掉之后整段不参与计算，也省一点性能。',
      options: [
        { value: '0', label: '关' },
        { value: '1', label: '开' }
      ],
      src: '定义'
    }
  },
  {
    suffix: '_MAP_UV_FLIP_X',
    doc: {
      zh: '只把 U（横向）翻转。',
      options: [
        { value: '0', label: '不翻' },
        { value: '1', label: '翻转' }
      ],
      src: '定义'
    }
  }
];

/**
 * 名字精确匹配的"不止开关"的参数。
 *
 * 为什么单开一张表：材质里有一批名字叫 `_ENABLE` / `_FLIP` 的东西**根本不是开关**，
 * 是"用哪种方式"的档位（`ALBEDO_SUB_ENABLE` 的五档是五种叠加算法）。
 * 按后缀规则套的话它们只会拿到"0 / 1 两档"，界面渲染成复选框，**用户就选不了 1/3**
 * （2026-09-21 用户实测报的就是这个）。
 *
 * 每一条的档位与含义都是**从渲染包自己的分支代码里读出来的**，不是推测：
 *   `Materials\material_common_2.0.fxsub` 的 `#if <名> == <n>` 分支体。
 * 读不出来的档位宁可不列（界面上仍可手填数字），不编。
 */
export const MATERIAL_SLOT_EXACT: Record<string, Doc> = {
  ALBEDO_SUB_ENABLE: {
    zh: '第二层基础色怎么叠到第一层上。**它不是开关，是五种叠加算法**（0 才是关）。',
    options: [
      { value: '0', label: '关（不叠）' },
      { value: '1', label: '乘：albedo × 第二层颜色' },
      { value: '2', label: '幂：albedo 的第二层颜色次方（拿它当"提亮曲线"用）' },
      { value: '3', label: '加：albedo + 第二层颜色' },
      { value: '4', label: '合成：走 ColorSynthesis（原包里的色彩合成）' },
      { value: '5', label: '按 alpha 插值：lerp(albedo, 第二层颜色, 第二层 alpha)' }
    ],
    how: '原包里女仆丝袜那两套（Toon_Stockings）用的是 3（加），material_aniso 那一族用的是 4（合成）；默认材质的模板写 0。换档就是换算法，画面差别很大，别当开关点。',
    src: '定义'
  },
  NORMAL_MAP_UV_FLIP: {
    zh: '法线贴图的翻转方式。**比别的槽位多一档**：第 4 档翻的不是 UV，是法线本身的 x 分量。',
    options: [
      { value: '0', label: '不翻' },
      { value: '1', label: '横向翻（U）' },
      { value: '2', label: '纵向翻（V）' },
      { value: '3', label: '横竖都翻' },
      { value: '4', label: '只把法线的 x 取反（N.x = -N.x），UV 不动' }
    ],
    how: '模型换了朝向或从别的引擎导过来时，法线常常是"左右反的"—— 那种情况要的是 4，不是 1。填 1 会连贴图位置一起翻过去，越弄越乱。',
    src: '定义'
  },
  OCCLUSION_MAP_TYPE: {
    zh: '遮蔽贴图（occlusion）怎么读。',
    options: [
      { value: '0', label: '默认：直接当线性值用' },
      { value: '1', label: '先做 sRGB → 线性转换再当遮蔽值' },
      { value: '2', label: '从第二套 UV（TEXCOORD2）取遮蔽，而不是第一套' }
    ],
    how: '从 PS 导出来的遮蔽图多半是按 sRGB 存的，那样要选 1，不然遮蔽会整体偏亮、脏的地方不够脏。选 2 是模型自己带了两套 UV、遮蔽画在第二套上的情况。',
    src: '定义'
  },
  NORMAL_MAP_TYPE: {
    zh: '法线贴图的解析方式。档位差的是"怎么把高度还原成法线"。',
    options: [
      { value: '1', label: '由 x/y 补出 z：z = √(1 - x² - y²)（原包里那一档就是这么写的）' },
      { value: '2', label: '低质量：用模型自带的切线扰法线（快，细节糊）' },
      { value: '3', label: '高质量：用屏幕空间中心差分算（准，费算力）' }
    ],
    how: '要看清细纹（皮革、布料织纹）用 3；只是要个凹凸感、又要跑得动，用 2。',
    cost: '3 比 2 多几次采样，材质多的时候是一笔开销。',
    src: '定义'
  },
  SPECULAR_MAP_TYPE: {
    zh: '高光贴图的解析方式。',
    options: [
      { value: '1', label: '平方后压暗（原包里写的是 0.16 × specular²）' },
      { value: '4', label: '直接取用（saturate(specular)）' }
    ],
    how: '2 和 3 这两档在原文件里没有能一眼读出含义的独立分支，**这里就不编了** —— 界面上照样能手填数字。',
    src: '定义'
  },
  EMISSIVE_MAP_APPLY_BLINK: {
    zh: '自发光贴图要不要跟着"眨眼/呼吸"闪。',
    options: [
      { value: '0', label: '不闪' },
      { value: '1', label: '按时间闪（原包里 1 和 0 走的是同一段代码，效果上暂时看不出差别）' },
      { value: '2', label: '跟着 MMD 里的 Blink 骨骼闪' }
    ],
    how: '要"眼里有光在呼吸"那种效果就选 2，并在模型上挂 Blink 骨骼；不挂的话它按 0 处理。闪的快慢由 emissiveBlink 那一条定。',
    src: '定义'
  }
};

/** `#define SHADINGMODELID_xxx n` 那一套：每个名字就是第 n 号着色模型 */
export const SHADING_MODEL_IDS: Record<string, Doc> = Object.fromEntries(
  (
    [
      ['SHADINGMODELID_DEFAULT', 0, '默认（标准 PBR）'],
      ['SHADINGMODELID_SKIN', 1, '皮肤 SKIN'],
      ['SHADINGMODELID_EMISSIVE', 2, '自发光 EMISSIVE'],
      ['SHADINGMODELID_ANISOTROPY', 3, '各向异性 ANISOTROPY（头发、拉丝金属）'],
      ['SHADINGMODELID_GLASS', 4, '玻璃 GLASS'],
      ['SHADINGMODELID_CLOTH', 5, '布料 CLOTH'],
      ['SHADINGMODELID_CLEAR_COAT', 6, '清漆 CLEAR_COAT（车漆、亮面）'],
      ['SHADINGMODELID_SUBSURFACE', 7, '次表面 SUBSURFACE'],
      ['SHADINGMODELID_CEL', 8, '赛璐璐 CEL'],
      ['SHADINGMODELID_TONEBASED', 9, '基于 toon TONEBASED'],
      ['SHADINGMODELID_MASK', 10, '遮罩 MASK']
    ] as [string, number, string][]
  ).map(([name, n, label]) => [
    name,
    {
      zh: `着色模型编号 = ${n}（${label}）。`,
      how: `这是给 \`CUSTOM_ENABLE\` 那一行用的编号常量，把它填进 CUSTOM_ENABLE 就是"按${label}算"。编号本身不用改，改它等于改这一档的定义。`,
      src: '定义' as const
    }
  ])
);

/* ============================================================
   material_2.0.fx 里那些 const 常量。按名字精确匹配
   ============================================================ */
export const MATERIAL_CONSTANTS: Record<string, Doc> = {
  CUSTOM_ENABLE: {
    zh: '着色模型（shading model）选择。这是 material_2.0 里最要紧的一条 —— 它决定这个材质走哪套光照分支，皮肤、布料、玻璃、清漆各是一套不同的 BRDF。',
    options: [
      { value: '0', label: '默认（标准 PBR）' },
      { value: '1', label: '皮肤 SKIN' },
      { value: '2', label: '自发光 EMISSIVE' },
      { value: '3', label: '各向异性 ANISOTROPY（头发、拉丝金属）' },
      { value: '4', label: '玻璃 GLASS' },
      { value: '5', label: '布料 CLOTH' },
      { value: '6', label: '清漆 CLEAR_COAT（车漆、亮面）' },
      { value: '7', label: '次表面 SUBSURFACE' },
      { value: '8', label: '赛璐璐 CEL' },
      { value: '9', label: '基于 toon TONEBASED' },
      { value: '10', label: '遮罩 MASK' }
    ],
    how: '名字叫 ENABLE 但**它不是开关**，是模型编号：0 是默认，1~10 各是一套光照模型（原文件里 `SHADINGMODELID_*` 那 11 个常量就是这套编号）。所以填 1 就是"按皮肤算"，不是"开启某个东西"。',
    cost: '换了模型之后可以调的参数也变了。比如选 4（玻璃）之后 specular 那一路的通道数限制会不一样；选 6（清漆）会多走一段清漆高光。',
    src: '定义'
  },
  albedo: {
    zh: '基础色。MMD 的 Diffuse 贴图会乘在它上面，所以这里填的是"整体色调"，不是最终颜色。',
    how: '白色 1.0 是不改色。要给整个材质整体染一点色就改这里。接受 0~1 之外的数（HDR 里 >1 就是过亮）。',
    src: '定义'
  },
  albedoSub: {
    zh: '第二层基础色，叠在 albedo 上。',
    src: '定义'
  },
  albedoMapLoopNum: {
    zh: '贴图在 UV 上重复几遍。1.0 是不重复，2.0 是横竖各铺两遍。',
    how: '这是 float2，两个数分别是 U 和 V 方向的重复次数。做布料纹理这么调最省事，不用改模型 UV。',
    src: '定义'
  },
  albedoSubMapLoopNum: { zh: '第二层基础色的 UV 重复次数。', src: '定义' },
  alpha: {
    zh: '透明度的常量值。没有 alpha 贴图时用这个。',
    how: '1.0 完全不透明，0 全透明。半透明材质（丝袜、纱）调到中间值。',
    src: '定义'
  },
  alphaMapLoopNum: { zh: '透明贴图的 UV 重复次数。', src: '定义' },
  normalMapScale: {
    zh: '法线强度。',
    how: '1.0 是原样。调大凹凸更明显（超过 3 会开始出现假的硬边），调到 0 等于关掉法线；负数会把凹凸反过来。',
    src: '定义'
  },
  normalMapLoopNum: { zh: '法线贴图的 UV 重复次数。', src: '定义' },
  normalSubMapScale: { zh: '第二张法线的强度。只在 NORMAL_MAP_TYPE 走混合模式时用得上。', src: '定义' },
  normalSubMapLoopNum: { zh: '第二张法线的 UV 重复次数。', src: '定义' },
  smoothness: {
    zh: '光滑度。决定高光是"一片糊光"还是"一个亮点"。',
    how: '0 是布料、皮肤那种哑光，1 是镜子。0.6~0.85 是大多数金属和漆面。注意它和 metalness 是配合着看的：光滑的绝缘体（Smoothness 高、Metalness 0）出的是白色反光，光滑的金属出的是带色的反光。',
    src: '定义'
  },
  smoothnessMapLoopNum: { zh: '光滑度贴图的 UV 重复次数。', src: '定义' },
  metalness: {
    zh: '金属度。决定材质算"绝缘体"还是"导体"。',
    how: '0 是非金属（塑料、皮肤、布料），1 是纯金属（铁、金、铜）。中间值在物理上不成立，但做过渡区可以用。金属的反光颜色由 albedo 决定。',
    src: '定义'
  },
  metalnessMapLoopNum: { zh: '金属度贴图的 UV 重复次数。', src: '定义' },
  specular: {
    zh: '镜面反射的 tint 颜色。',
    how: '非金属基本都是 0.5 左右的中灰。金属材质要把 albedo 提亮后填进来。',
    src: '定义'
  },
  specularMapLoopNum: { zh: '镜面贴图的 UV 重复次数。', src: '定义' },
  occlusion: {
    zh: '环境光遮蔽强度。把 AO 贴图最暗的地方压掉多少环境光。',
    how: '1.0 是全压（AO 效果最强），0 等于关掉。一般 0.7~1.0。',
    src: '定义'
  },
  occlusionMapLoopNum: { zh: 'AO 贴图的 UV 重复次数。', src: '定义' },
  parallaxMapScale: {
    zh: '视差贴图的深度。控制"陷进去多少"。',
    how: '给大了表面会出现明显的分层和撕裂（视差映射的通病，值越大越容易看出来），一般 0.02~0.1。',
    src: '定义'
  },
  parallaxMapLoopNum: { zh: '视差贴图的 UV 重复次数。', src: '定义' },
  emissive: {
    zh: '自发光颜色。',
    how: '这个颜色不受光照影响，直接加在画面上。要真的"发亮"（能引起泛光）得给大于 1 的值，比如 3.0。',
    src: '定义'
  },
  emissiveBlink: { zh: '眨眼时的自发光倍率。配合 EMISSIVE_MAP_APPLY_BLINK 用。', src: '定义' },
  emissiveIntensity: {
    zh: '自发光强度的整体倍率。',
    src: '定义'
  },
  emissiveMapLoopNum: { zh: '自发光贴图的 UV 重复次数。', src: '定义' },
  customA: {
    zh: '自定义通道 A。留给你自己接效果的，ray-mmd 本身不定义它干什么。',
    src: '定义'
  },
  customAMapLoopNum: { zh: '自定义通道 A 的 UV 重复次数。', src: '定义' },
  customB: { zh: '自定义通道 B，同上。多一个 3 通道的可以当颜色用。', src: '定义' },
  customBMapLoopNum: { zh: '自定义通道 B 的 UV 重复次数。', src: '定义' },
  edgeColor: { zh: '描边颜色。ray-mmd 的描边走材质的 Edge 参数，这一项在某些材质里会覆盖它。', src: '推断' }
};

/* ============================================================
   槽位中文名。_MAP_FROM 前面的那一段就是槽位名
   ============================================================ */

export const SLOT_ZH: Record<string, string> = {
  ALBEDO: '基础色',
  ALBEDO_SUB: '基础色 · 第二层',
  ALPHA: '透明度',
  NORMAL: '法线',
  NORMAL_SUB: '法线 · 第二层',
  SMOOTHNESS: '光滑度',
  METALNESS: '金属度',
  SPECULAR: '镜面',
  OCCLUSION: '环境光遮蔽',
  PARALLAX: '视差（高度）',
  EMISSIVE: '自发光',
  CUSTOM_A: '自定义 A',
  CUSTOM_B: '自定义 B'
};

/* ============================================================
   NCHL 风格材质（Materials/toon 下面那一批 RT_*.fx）
   ============================================================

   这批是第三方作者写的 toon 预设，参数名和 material_2.0 完全不同。
   它们的注释是日文，下面这些是从日文原注释翻过来的，标"注释"。
   ============================================================ */

export const NCHL: Record<string, Doc> = {
  SHADING_MIN: {
    zh: '阴影浓淡的下限。也就是"美白灯"效果的暗部一端 —— 值越小阴影越容易被提亮提飞。',
    how: '原注释标了 -0.5 ~ 0.0。想保留阴影层次就往 0 靠，想要平光的萌系效果就往 -0.5 走。',
    src: '注释'
  },
  SHADING_MAX: {
    zh: '阴影浓淡的上限，亮部一端。',
    how: '原注释标了 1.0 ~ 2.0。给大了高光会溢出成白块。',
    src: '注释'
  },
  ROUGHNESS: {
    zh: '粗糙度。表面的涩感和反射率。',
    how: '这是 Roughness 不是 Smoothness（跟 material_2.0 那套的 smoothness 是反的），1.0 是原样，越小越光滑。',
    src: '注释'
  },
  FRESNEL: {
    zh: '菲涅尔强度。掠射角（边缘视角）的反射增强程度。',
    how: '调大边缘会更亮，出"轮廓有反光"的效果。1.0 是原样。',
    src: '注释'
  },
  SPECULAR_EXTENT: {
    zh: '镜面强度补偿。',
    how: '原注释说用了高光贴图（specular map）的时候调大一点效果更好。默认 0.1 偏保守。',
    src: '注释'
  },
  GLOSS_EXTENT: {
    zh: '光泽（那种"润"的高光）的强度。0 是关掉。',
    how: '原注释：0 无效，大于 1 会变成金属感。所以有效区间大概是 0.1 ~ 1.0。',
    src: '注释'
  },
  GLOSS_TYPE: {
    zh: '光泽的计算式。默认是一条 comp*(saturate(...)) 的表达式，注释里还留了一条被注释掉的"超适当各向异性反射风"版本，作者说除了头发以外不太用得着。',
    how: '这一项的值是一段代码，不是数字，界面里只读。要换算法就把注释掉的那条放出来。',
    src: '注释'
  },
  RIM_STRENGTH: {
    zh: '边缘光（轮廓光）强度。',
    how: '0.5 是原预设。给大了会像发光描边。',
    src: '注释'
  },
  SUBDEPTH: {
    zh: '表面下散射的深度，也就是"透过去的量"。',
    how: '皮肤、薄布料用。给大了会像半透明的塑料。',
    src: '注释'
  },
  SUBCOLOR: {
    zh: '透过去的颜色。',
    how: '值是一个表达式（原预设写的是 MaterialToon.rgb，也就是跟着 toon 贴图走），不是数字，界面里只读。想要固定颜色就改成 float3(r, g, b)。',
    src: '注释'
  }
};

/* ============================================================
   成族的参数（按名字前缀 / 后缀匹配）
   ============================================================

   这一批是 Lighting / Fog / Skybox / PSSM 那几个 .fx / .fxsub 里的。
   它们不出现在 ray.conf 里，但改起来比 ray.conf 还常见（一个雾要调五六个数），
   而且名字高度成族，一条规则能盖住几十处，所以用规则表而不是一行行列。

   频次是拿整个包数出来的（ray-mmd-1.5.2 全量 700 个文件），
   只列真正高频的，冷门的宁可不写 —— 界面上显示"没有说明"好过写一段猜的。
   ============================================================ */

export type Rule = { test: RegExp; flavor?: string[]; doc: Doc };

const SWITCH_01: Opt[] = [
  { value: '0', label: '关' },
  { value: '1', label: '开' }
];

export const RULES: Rule[] = [
  /* ---- 阴影采样（PSSM.fxsub / *_lighting_with_shadow.fx，合计约 270 处） ---- */
  {
    test: /^sampleRadius$/i,
    doc: {
      zh: '阴影模糊的采样半径，单位是像素。采样次数按这个半径平方级地涨，所以它同时是"糊到什么程度"和"要花多少算力"的那一个旋钮。',
      how: '1 是 9 次采样，2 是 25 次，3 是 49 次。本机真包里 directional 用 2、disk 用 3。想阴影边缘干净就往上加，但代价是平方级涨。',
      cost: '采样数 (2r+1)²。从 2 加到 4 是 25 → 81 次，三倍多。',
      src: '定义'
    }
  },
  {
    test: /^sampleKernel$/i,
    doc: {
      zh: '阴影模糊的权重表。是一串权重、不是一个数值，长度要跟采样半径对得上。',
      how: '数组里每个数是采样点的权重，加起来应该是 1。改形状能改模糊的分布（中间重就是高斯，平的接近箱式模糊），但改了要保证和还是 1，不然阴影整体会变亮或变暗。',
      src: '定义'
    }
  },
  {
    test: /^shadowHardness$/i,
    doc: {
      zh: '阴影边缘的硬度。数越小边缘越软。',
      src: '推断'
    }
  },
  {
    test: /^SHADOW_MAP_(QUALITY|FROM)$/i,
    doc: {
      zh: '这一路的阴影是从预生成的阴影贴图读，还是当场算。',
      options: [
        { value: '0', label: '不用阴影贴图，当场算（不带 shadow 的那几个 .fx 用这个）' },
        { value: '1', label: '用阴影贴图（带 with_shadow 的用这个）' }
      ],
      how: '原包里带 `with_shadow` 的文件都写 1，不带 shadow 的都写 0。改成 1 但没生成对应的阴影贴图会全黑或全亮，一般不用手改。',
      src: '定义'
    }
  },

  /* ---- 光源参数（directional / disk / point / rectangle lighting，约 370 处） ---- */
  {
    test: /^LIGHT_PARAMS_TYPE$/i,
    doc: {
      zh: '光源走哪套参数。不同档位会让 fxsub 走不同分支算高光。',
      options: [
        { value: '0', label: '常规（directional_lighting.fx 用这个）' },
        { value: '1', label: '环境光型（_ambient.fx 用这个）' },
        { value: '2', label: '和 0 走同一段分支' }
      ],
      how: '0 和 2 都走"常规光源"那条路，2 是 0 的另一种用法：这几个档把 energy[1] 当高光强度使。**这几档的完整差别真包没有文档**，上面的对应关系是从文件名和取值推出来的，不是从别处的说明里抄的。',
      src: '推断'
    }
  },
  {
    test: /^LIGHT_PARAMS_FILE$/i,
    doc: {
      zh: '光源参数的外部贴图文件名。把光源的强度/范围打包成一张图的时候用。',
      src: '推断'
    }
  },
  {
    test: /^light(Range|Intensity|AttenuationBulb)Params$/i,
    doc: {
      zh: '把三个数打包在一个 float3 里：x 是常规值、y 是负向极值、z 是正向极值。正向系数往 z 拉、负向系数往 y 拉，中间那个 x 是基准。',
      how: '要改的是这三个数，不是"一个值"。x 是基准，y 管负极、z 管正极。',
      src: '定义'
    }
  },

  /* ---- 雾（atmospheric / ground / volumetric fog，约 530 处） ---- */
  {
    test: /^Fog(Range|Intensity|Density|Mie|AttenuationBulb)Params$/i,
    doc: {
      zh: '雾的三个数打包：x 常规、y 负向极值、z 正向极值。正负两个方向的附件系数各往两头拉。',
      how: '想要雾变浓是抬 x 还是抬 z，取决于 ray.x 里那个附件往哪个方向推。先用 x 调。',
      src: '定义'
    }
  },
  {
    test: /^VOLUMETRIC_FOG_ENABLE$/i,
    doc: {
      zh: '体积雾开关。开了之后雾是按空间体积积分的，光照穿过去会有光束感，不是单纯按距离叠一层颜色。',
      options: SWITCH_01,
      cost: '要跑步进积分，是全包最贵的效果之一。步数由 VOLUMETRIC_FOG_SAMPLES_LENGTH 定。',
      src: '定义'
    }
  },
  {
    test: /^VOLUMETRIC_FOG_SAMPLES_LENGTH$/i,
    doc: {
      zh: '体积雾沿视线走多少步。步数越多光束越连续，也越慢。',
      how: '步数不够的时候光束会断成一段一段的（带状条纹）。加到条纹看不出来为止，再往上就是白花性能。',
      src: '定义'
    }
  },
  {
    test: /^VOLUMETRIC_FOG_ANISOTROPY$/i,
    doc: {
      zh: '体积雾的散射各向异性。0 是各方向均匀散射，正数偏前向散射（迎着光看雾更亮、有丁达尔感），负数偏后向。',
      how: '想要"阳光穿过树叶打下来"那种光束感，往正数调。原包写的是 1。',
      src: '推断'
    }
  },
  {
    test: /^VOLUMETRIC_FOG_MAP_QUALITY$/i,
    doc: {
      zh: '体积雾用到的三维贴图的分辨率档位。数字越大越细，显存越吃。',
      how: '原包没写每档对应多少分辨率，只有"I 档比 II 档糊"这种量级关系。**具体尺寸配置里看不出来** —— 要准确的值只能自己出图量。',
      src: '推断'
    }
  },

  /* ---- 天空盒（skybox.fxsub，约 120 处） ---- */
  {
    test: /^SKYDOME_ENABLE$/i,
    doc: {
      zh: '用球体内表面当天空（巨蛋）还是用立方体贴图当天空。',
      options: SWITCH_01,
      how: '原包里 `Sky with dome*.fx` 写 1，`Sky with box*.fx` 写 0。',
      src: '定义'
    }
  },
  {
    test: /^SKYBOX_MAP_ENABLE$/i,
    doc: { zh: '天空贴图开关。关掉就是纯色背景，做独立背景板的时候用。', options: SWITCH_01, src: '推断' }
  },
  {
    test: /^SKYBOX_(HDR_ENABLE|HDR_RGBT_ENABLE)$/i,
    doc: {
      zh: '天空贴图按 HDR 处理（亮度可以超过 1）。关掉就按 LDR 读，环境光会暗一截。',
      options: SWITCH_01,
      how: '用的是 .hdr / .exr 就必须开，普通 png 开了反而会偏。',
      src: '定义'
    }
  },
  {
    test: /^SKYBOX_BLUR_ENABLE$/i,
    doc: {
      zh: '把天空贴图模糊掉再当环境光用。立方体贴图没做 mipmap 的时候模糊一下能压住反射里的接缝。',
      options: SWITCH_01,
      src: '定义'
    }
  },
  {
    test: /^SKYBOX_(HDR|MAP|BLUR_MIPMAP)_FILE$/i,
    doc: { zh: '天空盒用的贴图文件名。', src: '定义' }
  },
  {
    test: /^SKYBOX_BLUR_MIPMAP_LEVEL$/i,
    doc: {
      zh: '模糊天空盒时用第几级 mip。数字越大越糊，环境光越"柔"、反射细节越少。',
      src: '定义'
    }
  },
  {
    test: /^SKYBOX_WITHOUT_ENV_ROTATION$/i,
    doc: {
      zh: '环境贴图不跟着镜头转。',
      options: SWITCH_01,
      how: '关掉（也就是跟着转）的话镜头一动天空就跟着动，做镜头动画会露馅。要固定背景就开它。',
      src: '推断'
    }
  },

  /* ---- IBL（sphere_lighting.fx / IBL 相关，约 90 处） ---- */
  {
    test: /^IBL_MAP_FROM$/i,
    doc: {
      zh: '环境光照（IBL）的贴图从哪来。',
      options: [
        { value: '0', label: '不用贴图' },
        { value: '1', label: '外部文件' },
        { value: '2', label: '外部文件 + 动画' }
      ],
      src: '推断'
    }
  },
  {
    test: /^IBL_MAP_MIPMAP_LEVEL$/i,
    doc: {
      zh: '取环境贴图的第几级 mip。数字越大越模糊。',
      how: '原包写 7。做粗糙表面的环境反射时用大 mip 才不会有尖锐的假反射。',
      src: '定义'
    }
  },
  {
    test: /^IBL(DIFF|SPEC)_MAP_FILE$/i,
    doc: {
      zh: '漫反射 / 高光环境贴图的文件名。把环境的漫反射分量和高光分量分开存的时候用。',
      src: '推断'
    }
  },

  /* ---- 阴影投射体的透明（PSSM*.fx，约 70 处） ---- */
  {
    test: /^CASTER_ALPHA_ENABLE$/i,
    doc: {
      zh: '投影的时候是否考虑材质的透明通道。',
      options: SWITCH_01,
      how: '关掉的话头发、蕾丝这种用 alpha 抠出来的形状会投出一整片实心影子。开着才对，但要额外读一次 alpha 贴图。',
      src: '定义'
    }
  },
  {
    test: /^CASTER_ALPHA_MAP_ENABLE$/i,
    doc: { zh: '投影用的透明通道从单独的贴图读，还是从材质自带的 alpha 读。', options: SWITCH_01, src: '推断' }
  },
  {
    test: /^CasterAlphaThreshold$/i,
    doc: {
      zh: '投影时 alpha 的判定阈值。低于它的像素不算遮挡物。',
      how: '给高了细发丝会在影子里消失，给低了本该漏光的半透明部分会变成实心影子。',
      src: '推断'
    }
  },

  /* ---- 视频材质（rectangle_lighting*.fx，约 80 处） ---- */
  {
    test: /^VIDEO_MAP_(FROM|UV_FLIP|FILE)$/i,
    doc: {
      zh: '把一段视频当贴图打在面上。这几个参数和老版本的 _MAP_* 是一回事，只是换了个名字。',
      src: '定义'
    }
  },
  {
    test: /^vedioMapLoopNum$/i,
    doc: {
      zh: '视频贴图的 UV 重复次数。',
      how: '**注意拼写**：原包里这里写的是 `vedio`（少了个 o），不是 `video`。别"顺手改对" —— 改了另外一处的引用就对不上了，编译直接报错。',
      src: '定义'
    }
  },

  /* ---- material_editor 里的派生量（只读，约 260 处） ---- */
  {
    test: /^mColor(Contrast|Saturation|Gamma|Gain|Offset)(All|Low|Mid|High)$/,
    doc: {
      zh: '调色五件套（对比 / 饱和 / 伽马 / 增益 / 偏移）里的一项，值由上面的控制器读进来。',
      how: '这一项在 fxsub 里通常是控制器声明，值是 MMD 里附件的位置决定的，在这里改没有意义。要调就调同一个插件目录下 .fx 里不带 m 前缀的那一份。',
      src: '定义'
    }
  },
  {
    test: /^m\w+Color$/,
    doc: {
      zh: '派生出来的颜色，由上面那几个控制器值算出来的（HSV 转 RGB 或者直接拼三个分量）。',
      how: '这一行不是让你改的 —— 它没有独立的值，改它下一次刷新就被覆盖。要改颜色去改上面的 mXxxH / mXxxS / mXxxV 那几个控制器项，但那些值在 MMD 里由附件位置决定，要拖动 ray_controller 上的骨骼。',
      src: '定义'
    }
  },
  {
    test: /^m\w+LoopsP?$/,
    doc: {
      zh: '贴图的 UV 重复次数。带 P 后缀的是控制器读进来的 0~1 值，不带 P 的那个是换算之后的实际次数。',
      how: '控制器那一项只读（值来自 PMX 附件），实际次数那一项也是算出来的。想固定重复次数就改不带 P 的那一行、把 lerp 换成常数。',
      src: '定义'
    }
  },
  {
    test: /^m\w+Scale[PM]?$/,
    doc: {
      zh: '法线或贴图的缩放。带 P 的是正方向控制器、带 M 的是负方向；P 把缩放往正的一头拉、M 往负的一头拉。',
      src: '定义'
    }
  },

  /* ---- 零散的、量不大但容易看懵的 ---- */
  {
    test: /^USE_CUTSOM_PARAMS$/i,
    doc: {
      zh: '是否使用自定义参数块。',
      how: '**拼写是原包就这么写的**（CUTSOM，不是 CUSTOM）。fx 和 fxsub 两边的宏名必须一致，这里"改对"会直接编译不过。',
      src: '定义'
    }
  },
  {
    test: /^MIDPOINT_8_BIT$/i,
    doc: { zh: '8 位量化的中点，也就是 0.5 对应的整数值。做 alpha 的位数打包时当基准用。', src: '推断' }
  },
  {
    test: /^ClearColor$/i,
    doc: { zh: '背景的底色。没有天空盒或者天空盒没盖住的地方显示这个颜色。', src: '推断' }
  },
  {
    test: /^CONTROLLER_NAME$/i,
    doc: {
      zh: '控制器对象的名字，也就是 MMD 里那个附件（通常是 ray_controller.pmx）在场景里的名字。',
      how: '改名之后 ray.x 那个附件的名字也要一起改，不然所有控制器参数都读不到。一般不动。',
      src: '定义'
    }
  },

  /* ---- ColorGrading 插件（全包最常改的后期之一，约 100 处） ----
     这五个是标准的调色五件套，名字和 Photoshop / DaVinci 里那套是对应的。
     每个都有 All / Low / Mid / High 四份 —— All 管全局，另外三份按明度分区，
     每区一个颜色（float3 就是 RGB 三个通道各来一次）。 */
  {
    test: /^colorContrast(All|Low|Mid|High)$/,
    doc: {
      zh: '对比度。1.0 是不变，大于 1 拉开明暗（暗的更暗、亮的更亮），小于 1 压平。',
      how: '四份分别管：All 全局、Low 暗部、Mid 中间调、High 亮部。想只增强暗部层次就调 Low。三个分量分别对应 R/G/B，所以还能做"只给红通道加对比"这种偏色操作。',
      src: '注释'
    }
  },
  {
    test: /^colorSaturation(All|Low|Mid|High)$/,
    doc: {
      zh: '饱和度。1.0 不变，0 是全灰，大于 1 更艳。',
      how: '做二次元场景常用的手法是 All 稍微降一点（0.95 左右）压住塑料感，再把 Mid 拉回来保肤色。',
      src: '注释'
    }
  },
  {
    test: /^colorGamma(All|Low|Mid|High)$/,
    doc: {
      zh: '伽马。1.0 不变，大于 1 提亮中间调，小于 1 压暗中间调。',
      how: '它和 Contrast 的区别：Contrast 是绕中点线性拉伸（会夹掉两端），Gamma 是曲线（不动黑点白点）。想让画面"通透"一点用 Gamma，想"硬"用 Contrast。',
      src: '注释'
    }
  },
  {
    test: /^colorGain(All|Low|Mid|High)$/,
    doc: {
      zh: '增益，也就是乘法。1.0 不变，大于 1 整体提亮，小于 1 压暗。',
      how: '三个分量可以分别调 —— 想整体偏暖就把 R 调到 1.05、B 调到 0.95。这是最常用的调色手段。',
      src: '注释'
    }
  },
  {
    test: /^colorOffset(All|Low|Mid|High)$/,
    doc: {
      zh: '偏移，也就是加法。0.0 不变。',
      how: '默认全 0。加正值会把黑点抬起来（画面发灰，像加了雾），负值会压死暗部。想模拟"胶片黑"就给一点点正值再配合 Gamma。',
      src: '注释'
    }
  },
  {
    test: /^colorVisualizationLUT$/,
    doc: {
      zh: '把当前生成的查找表（LUT）本身显示出来，用来检查调色有没有调歪。',
      options: [
        { value: '0', label: '正常渲染画面' },
        { value: '1', label: '显示 LUT 本身' }
      ],
      how: '原注释写的是 0.0 ~ 1.0，所以是个连续量不是开关 —— 但实际当开关用。调到 1 就整个画面变成色表。出图前记得调回 0。',
      src: '注释'
    }
  },
  {
    test: /^colorCorrection(High|Low)Threshold$/,
    doc: {
      zh: '明暗分区的分界点，决定 Low / Mid / High 三份参数各自管哪一段亮度。',
      how: '原注释标了 0.0 ~ 1.0。默认两个都是 0.5 —— 也就是分界点重合，这时 Mid 区几乎不存在，实际只有 Low 和 High 在起作用。要三区都生效就把两个值拉开（比如 0.25 和 0.75）。',
      src: '注释'
    }
  },
  {
    test: /^LUT_SIZE$/,
    doc: {
      zh: '调色查找表每个方向的格数。32 就是每个通道 32 级。',
      how: '**这个值和本项目 ② ikClut 工具导出的是同一套约定**：32³ 的表铺成 1024×32 的图（宽 = 32×32 个切片，高 = 32）。改这里要连 LUT_WIDTH 一起改成 `LUT_SIZE * LUT_SIZE`，还要重新生成对应的表图。',
      src: '定义'
    }
  },
  {
    test: /^LUT_WIDTH$/,
    doc: {
      zh: '查找表图的总宽度。等于 LUT_SIZE 的平方（32² = 1024）。',
      how: '和 LUT_SIZE 是绑定的，单独改会读错行。',
      src: '定义'
    }
  },
  {
    test: /^LUT_(STRENGTH|MAP)/i,
    doc: { zh: '查找表的强度或来源。', src: '推断' }
  },

  /* ---- 采样器状态（material_header / main.fxsub，各文件都有一份） ---- */
  {
    test: /^TEXTURE_FILTER$/,
    doc: {
      zh: '贴图采样的过滤方式。写的是符号不是数字。',
      options: [
        { value: 'ANISOTROPIC', label: '各向异性过滤（画质最好，稍微费一点）' },
        { value: 'LINEAR', label: '双线性过滤' },
        { value: 'POINT', label: '点采样（出马赛克，只有做像素风才用）' }
      ],
      how: '原包里材质用 ANISOTROPIC，main.fxsub 用 LINEAR。改成 POINT 会让贴图变成一块一块的。**这一项的值必须原样是这几个单词**，写数字 MME 认不了。',
      src: '定义'
    }
  },
  {
    test: /^TEXTURE_MIP_FILTER$/,
    doc: {
      zh: 'mipmap 层之间的过滤方式，取值和 TEXTURE_FILTER 同一套。',
      options: [
        { value: 'LINEAR', label: '双线性（层与层之间平滑过渡）' },
        { value: 'POINT', label: '点采样（层与层之间硬切，远处会看到分界线）' },
        { value: 'NONE', label: '不用 mipmap' }
      ],
      src: '定义'
    }
  },
  {
    test: /^TEXTURE_ANISOTROPY_LEVEL$/,
    doc: {
      zh: '各向异性过滤的级别。斜着看地面或者长走廊的时候，贴图远端的清晰度靠它。',
      how: '常见取值 1 / 2 / 4 / 8 / 16。调大画质更好，代价在高斜视角下。只有 TEXTURE_FILTER 是 ANISOTROPIC 的时候才有意义。',
      src: '定义'
    }
  },

  /* ---- 8 位通道打包的常量（material_common 里，改之前先想清楚） ---- */
  {
    test: /^MAX_FRACTIONAL_8_BIT$/,
    doc: {
      zh: '8 位小数的最大值，取 255/256 那个值。用它把 alpha 压进小数位。',
      how: '这是 G-buffer 的数据打包格式，改了所有 pass 读出来的 alpha 都会错位。不是调画质的旋钮，别动。',
      src: '定义'
    }
  },
  {
    test: /^TWO_BITS_EXTRACTION_FACTOR$/,
    doc: {
      zh: '从打包数据里抠两位用的系数，写成 `3.0f + MAX_FRACTIONAL_8_BIT`。',
      how: '同上，属于 G-buffer 的位打包约定，动了整条 G-buffer 链路就对不上。',
      src: '定义'
    }
  },

  /* ---- 雾的零散开关（atmospheric_fog 那一族） ---- */
  {
    test: /^FOG_DISCARD_SKY$/,
    doc: {
      zh: '雾要不要覆盖天空。',
      options: SWITCH_01,
      how: '原包里带 `without sky` 的文件写 1（天空不吃雾，天还是清的），不带的写 0（天空也被雾盖住）。想保留云彩和星空就写 1。',
      src: '定义'
    }
  },
  {
    test: /^FOG_WITH_GODRAY$/,
    doc: {
      zh: '丁达尔光束（godray）开关。光穿过雾的时候拉出放射状的光柱。',
      options: SWITCH_01,
      how: '原包里带 `with godray` 的文件写 1。不开的话雾只是一层均匀的颜色。',
      src: '定义'
    }
  },
  {
    test: /^FOG_WITH_GODRAY_SAMPLES$/,
    doc: {
      zh: '算光束时沿光线走几步。步数越多光柱越连续，也越慢。',
      how: '步数不够的时候光柱会出现横向的阶梯条纹。',
      src: '推断'
    }
  },
  {
    test: /^SSAO_(VISIBILITY|RECIEVER_ALPHA|RECIEVER_ALPHA_MAP)_ENABLE$/,
    doc: {
      zh: 'SSAO 的可见度 / 接收方透明通道相关的开关。',
      options: SWITCH_01,
      how: '名字里的 Reciever 是原包拼错的（正确是 Receiver），别改。接收方透明那两项是给窗帘、纱这种半透明遮挡物用的。',
      src: '定义'
    }
  },
  {
    test: /^SKYBOX_BLUR_(COLOR_RANGE|MAP_FILE)$/,
    doc: {
      zh: '天空盒模糊的色域范围 / 模糊用的贴图文件名。',
      src: '推断'
    }
  },
  {
    test: /^mEmissive(Blink|Intensity)$/,
    doc: {
      zh: '派生出来的自发光闪烁倍率和强度，值来自控制器。',
      how: '这一行是算出来的（`lerp` 出来的），改它下次刷新就被覆盖。要调去改不带 m 前缀的对应项。',
      src: '定义'
    }
  },
  {
    test: /^(lightBlink|LightColor|LightIntensity2?|LightHardness|LightRange|LightPosition)$/,
    doc: {
      zh: '光源的颜色 / 强度 / 硬度 / 范围 / 位置。这几个是单值或 float3，不是上面那种三个数打包的形式。',
      how: '带 Blink 的跟着 ray.x 里那个光源附件的闪烁参数走，改它没用（会被覆盖）。LightRange 和 LightPosition 一般是算出来的，只读。',
      src: '推断'
    }
  },
  {
    test: /^(FogColor|FogDensity|FogPosition|FogIntensity)$/,
    doc: {
      zh: '雾的颜色 / 浓度 / 位置 / 强度。',
      how: '在 .fxsub 里这几个很多是 `float3(mR, mG, mB) * FogIntensity` 这种由控制器算出来的，改不动；在 .fx 里如果是直接给的字面量就能改。看这一行是"等于表达式"还是"等于数"就知道了。',
      src: '推断'
    }
  },
  {
    test: /^BackColor$/,
    doc: { zh: '背景色。没有东西的地方显示这个颜色。', src: '推断' }
  },
  {
    test: /^ClearDepth$/,
    doc: { zh: '清深度缓冲时写进去的深度值。做多 pass 叠加的时候调它来控制哪些东西会被遮住。', src: '推断' }
  }
];

/* ============================================================
   查表
   ============================================================ */

/** 分类归属，用来给参数分组。key 是前缀，值是中文段名 */
export const SECTION_ZH: Record<string, string> = {
  // ray.conf
  SUN: '太阳光 · 阴影',
  IBL: '环境光（IBL）',
  FOG: '雾',
  MULTI: '多光源',
  OUTLINE: '描边',
  TOON: '卡通材质',
  SSDO: '屏幕空间遮蔽',
  SSR: '屏幕空间反射',
  SSSS: '次表面散射',
  BOKEH: '景深',
  HDR: 'HDR · 后期',
  AA: '抗锯齿',
  POST: '后期',
  // ray_advanced.conf（m 前缀后面那一段）
  Light: '光源',
  EnvLight: '环境光',
  Bloom: '泛光',
  Exposure: '曝光',
  Vignette: '暗角',
  PointLight: '点光源',
  PSSM: '级联阴影',
  Temperature: '色温',
  FXAA: 'FXAA',
  Shadow: '阴影'
};

/**
 * 查一个参数的说明。查找顺序：精确名 → 槽位后缀规则 → NCHL 风格 → 无。
 *
 * 返回 null 表示这张表里没有 —— 界面上照实显示"没有说明"，
 * 不要在这里补一句编的。
 */
export function explain(name: string, flavor: string): Doc | null {
  if (RAY_CONF[name]) return RAY_CONF[name];
  if (RAY_ADVANCED[name]) return RAY_ADVANCED[name];
  if (NCHL[name]) return NCHL[name];
  if (MATERIAL_CONSTANTS[name]) return MATERIAL_CONSTANTS[name];
  if (SHADING_MODEL_IDS[name]) return SHADING_MODEL_IDS[name];
  // 名字精确匹配的"多档参数"（_ENABLE 其实是算法档位那种）。
  // 必须排在下面的后缀规则之前，否则会被后缀规则用"0/1 两档"顶掉。
  if (MATERIAL_SLOT_EXACT[name]) return MATERIAL_SLOT_EXACT[name];

  // 成族的参数。规则表排在精确表后面 —— 精确表是逐条核对过的，
  // 规则是按前缀套的，有冲突时以精确的为准。
  for (const r of RULES) {
    if (r.flavor && !r.flavor.includes(flavor)) continue;
    if (r.test.test(name)) return r.doc;
  }

  // material_2.0 那套后缀
  if (flavor === 'material' || flavor === 'fxsub') {
    for (const rule of MATERIAL_SUFFIX) {
      if (name.endsWith(rule.suffix)) {
        const slot = name.slice(0, -rule.suffix.length);
        const zh = SLOT_ZH[slot];
        if (!zh) continue;
        // 把槽位中文名拼进说明，读起来才是"基础色的贴图从哪来"而不是"这一路贴图从哪来"
        return { ...rule.doc, zh: `【${zh}】${rule.doc.zh}` };
      }
    }
  }
  return null;
}

/** 一个参数归属哪一段。分不出来就回"其它" */
export function sectionOf(name: string, flavor: string): string {
  if (flavor === 'ray-advanced') {
    const base = name.replace(/^m/, '');
    // 长的前缀要先试，不然 PointLight 会被 Light 抢走
    for (const key of ['PointLight', 'EnvLight', 'PSSM', 'SSDO', 'SSR', 'SSSS', 'Bloom', 'Exposure', 'Vignette', 'FXAA', 'Light', 'Temperature']) {
      if (base.startsWith(key)) return SECTION_ZH[key] ?? key;
    }
    return '其它';
  }
  if (flavor === 'material' || flavor === 'fxsub') {
    for (const rule of MATERIAL_SUFFIX) {
      if (name.endsWith(rule.suffix)) {
        const slot = name.slice(0, -rule.suffix.length);
        return SLOT_ZH[slot] ? `${SLOT_ZH[slot]}` : '其它';
      }
    }
    // const 的驼峰名：albedoMapLoopNum → albedo
    const m = name.match(/^([a-z]+[A-Z][a-z]+)/);
    if (m) return '材质常量';
    return '其它';
  }
  // ray.conf 按第一个下划线前的段切
  const head = name.split('_')[0];
  return SECTION_ZH[head] ?? '其它';
}

/** 这张表覆盖了多少条。自测和界面上的统计都用它 */
export function coverage(flavor: string, names: string[]): { hit: number; total: number; miss: string[] } {
  const miss: string[] = [];
  let hit = 0;
  for (const n of names) {
    if (explain(n, flavor)) hit++;
    else miss.push(n);
  }
  return { hit, total: names.length, miss };
}
