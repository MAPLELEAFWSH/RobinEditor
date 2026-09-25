/**
 * 离线术语表。
 *
 * 这份表只干一件事：把 MMD / MME 圈里那些固定说法换成中文。
 * **它不是机器翻译**，句子的语法结构不管 —— 「この影は〜を追加します」这种
 * 整句进来，出来的是「这个阴影是〜を添加します」这种半成品。
 * 界面上要如实说明这一点，并且把没覆盖到的部分标出来，让人自己补。
 *
 * 为什么不做在线翻译：方案冻结时就定了走离线。工具要能断网用，
 * 而且渲染包的注释里有一半是作者名、ライセンス条文这种不能乱翻的东西。
 *
 * 表的组织：长的放前面。匹配时贪最长，所以「半透明」不会被「透明」抢走。
 */

export type GlossaryEntry = { jp: string; cn: string };

/** 内置词条。按类分块只是为了好维护，匹配时是一张平表。 */
const GROUPS: Record<string, GlossaryEntry[]> = {
  渲染与光照: [
    { jp: 'アンビエント', cn: '环境光' },
    { jp: 'ディフューズ', cn: '漫反射' },
    { jp: 'スペキュラ', cn: '镜面反射' },
    { jp: 'ハイライト', cn: '高光' },
    { jp: 'リムライト', cn: '边缘光' },
    { jp: 'エミッシブ', cn: '自发光' },
    { jp: '自己発光', cn: '自发光' },
    { jp: '発光', cn: '发光' },
    { jp: '半透明', cn: '半透明' },
    { jp: '透過', cn: '透明' },
    { jp: '透明度', cn: '透明度' },
    { jp: '不透明度', cn: '不透明度' },
    { jp: '反射', cn: '反射' },
    { jp: '屈折率', cn: '折射率' },
    { jp: '屈折', cn: '折射' },
    { jp: '影の色', cn: '阴影颜色' },
    { jp: '影色', cn: '阴影色' },
    { jp: 'シャドウ', cn: '阴影' },
    { jp: 'セルフシャドウ', cn: '自阴影' },
    { jp: '影', cn: '阴影' },
    { jp: '光源', cn: '光源' },
    { jp: 'ライト', cn: '灯光' },
    { jp: '光', cn: '光' },
    { jp: '環境光', cn: '环境光' },
    { jp: '環境', cn: '环境' },
    { jp: 'トゥーン', cn: '卡通' },
    { jp: '輪郭', cn: '轮廓' },
    { jp: 'アウトライン', cn: '描边' },
    { jp: 'エッジ', cn: '边缘' },
    { jp: '金属', cn: '金属' },
    { jp: 'メタリック', cn: '金属度' },
    { jp: 'ラフネス', cn: '粗糙度' },
    { jp: '粗さ', cn: '粗糙度' },
    { jp: '光沢', cn: '光泽' },
    { jp: 'ノーマルマップ', cn: '法线贴图' },
    { jp: '法線', cn: '法线' },
    { jp: 'マスク', cn: '遮罩' },
    { jp: 'コントラスト', cn: '对比度' },
    { jp: '明度', cn: '明度' },
    { jp: '彩度', cn: '饱和度' },
    { jp: '色相', cn: '色相' },
    { jp: 'ガンマ', cn: '伽马' },
    { jp: '露出', cn: '曝光' },
    { jp: 'ぼかし', cn: '模糊' },
    { jp: '柔らか', cn: '柔和' },
    { jp: '彩度補正', cn: '饱和度校正' },
    { jp: '色調補正', cn: '色调校正' },
    { jp: 'グラデーション', cn: '渐变' },
    { jp: 'グラデ', cn: '渐变' }
  ],
  贴图与材质: [
    { jp: 'テクスチャ', cn: '贴图' },
    { jp: 'マテリアル', cn: '材质' },
    { jp: 'スフィアマップ', cn: '球面贴图' },
    { jp: 'スフィア', cn: '球面贴图' },
    { jp: 'トゥーンテクスチャ', cn: '卡通贴图' },
    { jp: 'ライトマップ', cn: '光照贴图' },
    { jp: '乗算スフィア', cn: '乘算球面' },
    { jp: '加算スフィア', cn: '加算球面' },
    { jp: 'サブテクスチャ', cn: '副贴图' },
    { jp: '解像度', cn: '分辨率' },
    { jp: '縦横', cn: '宽高' },
    { jp: '高さ', cn: '高度' },
    { jp: '幅', cn: '宽度' },
    { jp: 'サイズ', cn: '尺寸' },
    { jp: '中心', cn: '中心' },
    { jp: '範囲', cn: '范围' },
    { jp: '拡大', cn: '放大' },
    { jp: '縮小', cn: '缩小' },
    { jp: '繰り返し', cn: '平铺' },
    { jp: '座標', cn: '坐标' },
    { jp: 'UV座標', cn: 'UV 坐标' },
    { jp: 'チャンネル', cn: '通道' },
    { jp: '成分', cn: '分量' },
    { jp: '画素', cn: '像素' },
    { jp: 'ピクセル', cn: '像素' },
    { jp: '階調', cn: '色阶' },
    { jp: '境界', cn: '边界' }
  ],
  模型: [
    { jp: 'モデル', cn: '模型' },
    { jp: 'モーション', cn: '动作' },
    { jp: 'ボーン', cn: '骨骼' },
    { jp: '頂点', cn: '顶点' },
    { jp: '材質', cn: '材质' },
    { jp: 'モーフ', cn: '变形' },
    { jp: '表情', cn: '表情' },
    { jp: 'アクセサリ', cn: '配件' },
    { jp: '剛体', cn: '刚体' },
    { jp: 'ジョイント', cn: '关节' },
    { jp: '物理演算', cn: '物理运算' },
    { jp: 'ウェイト', cn: '权重' },
    { jp: '前髪', cn: '前发' },
    { jp: '後髪', cn: '后发' },
    { jp: '髪', cn: '头发' },
    { jp: '肌', cn: '皮肤' },
    { jp: '顔', cn: '脸' },
    { jp: '体', cn: '身体' },
    { jp: '服', cn: '衣服' },
    { jp: '靴', cn: '鞋' },
    { jp: '武器', cn: '武器' }
  ],
  界面与操作: [
    { jp: 'エフェクト', cn: '特效' },
    { jp: 'シェーダー', cn: '着色器' },
    { jp: 'コントローラー', cn: '控制器' },
    { jp: 'パラメータ', cn: '参数' },
    { jp: 'ファイル', cn: '文件' },
    { jp: 'フォルダ', cn: '文件夹' },
    { jp: 'フォルダ名', cn: '文件夹名' },
    { jp: 'パス', cn: '路径' },
    { jp: '設定', cn: '设置' },
    { jp: '初期値', cn: '初始值' },
    { jp: '既定値', cn: '默认值' },
    { jp: 'デフォルト', cn: '默认' },
    { jp: '最大値', cn: '最大值' },
    { jp: '最小値', cn: '最小值' },
    { jp: '上限', cn: '上限' },
    { jp: '下限', cn: '下限' },
    { jp: '有効', cn: '开启' },
    { jp: '無効', cn: '关闭' },
    { jp: '使用する', cn: '使用' },
    { jp: '使用しない', cn: '不使用' },
    { jp: '変更', cn: '修改' },
    { jp: '削除', cn: '删除' },
    { jp: '追加', cn: '添加' },
    { jp: '保存', cn: '保存' },
    { jp: '読み込み', cn: '读取' },
    { jp: '書き込み', cn: '写入' },
    { jp: '出力', cn: '输出' },
    { jp: '入力', cn: '输入' },
    { jp: '選択', cn: '选择' },
    { jp: '適用', cn: '应用' },
    { jp: '反映', cn: '生效' },
    { jp: '更新', cn: '更新' },
    { jp: '描画順', cn: '绘制顺序' },
    { jp: '描画', cn: '绘制' },
    { jp: '深度', cn: '深度' },
    { jp: '画面', cn: '屏幕' },
    { jp: '空間', cn: '空间' },
    { jp: '自動', cn: '自动' },
    { jp: '手動', cn: '手动' },
    { jp: '強制', cn: '强制' },
    { jp: '常に', cn: '始终' },
    { jp: '場合', cn: '情况' },
    { jp: '必要', cn: '需要' },
    { jp: '可能', cn: '可以' },
    { jp: '注意', cn: '注意' },
    { jp: '参考', cn: '参考' },
    { jp: '説明', cn: '说明' },
    { jp: '例', cn: '例' },
    { jp: '値', cn: '值' },
    { jp: '名前', cn: '名字' },
    { jp: '番号', cn: '编号' },
    { jp: '行', cn: '行' },
    { jp: '列', cn: '列' },
    { jp: '左', cn: '左' },
    { jp: '右', cn: '右' },
    { jp: '上', cn: '上' },
    { jp: '下', cn: '下' },
    { jp: '前', cn: '前' },
    { jp: '後', cn: '后' },
    { jp: '全部', cn: '全部' },
    { jp: '全て', cn: '全部' },
    { jp: '同じ', cn: '相同' },
    { jp: '別', cn: '另外' },
    { jp: '他の', cn: '其他的' },
    { jp: 'この', cn: '这个' },
    { jp: 'その', cn: '那个' },
    { jp: 'あの', cn: '那个' },
    { jp: 'ここ', cn: '这里' },
    { jp: 'そこ', cn: '那里' },
    { jp: '今回', cn: '这次' },
    { jp: '前回', cn: '上次' },
    { jp: '以上', cn: '以上' },
    { jp: '以下', cn: '以下' },
    { jp: '未満', cn: '不足' },
    { jp: '程度', cn: '程度' },
    { jp: '場合によって', cn: '视情况' },
    { jp: 'について', cn: '关于' },
    { jp: 'として', cn: '作为' },
    { jp: 'ため', cn: '为了' },
    { jp: 'なので', cn: '所以' },
    { jp: 'しかし', cn: '但是' },
    { jp: 'または', cn: '或者' },
    { jp: '及び', cn: '以及' },
    { jp: 'など', cn: '等等' },
    { jp: 'とは', cn: '指的是' },
    { jp: 'もの', cn: '东西' },
    { jp: 'こと', cn: '事情' },
    { jp: 'これ', cn: '这个' },
    { jp: 'それ', cn: '那个' },
    { jp: 'から', cn: '从' },
    { jp: 'まで', cn: '到' },
    { jp: 'より', cn: '比' },
    { jp: 'だけ', cn: '只' },
    { jp: 'ほど', cn: '程度' },
    { jp: '帰属', cn: '归属' },
    { jp: '受け取る', cn: '接收' },
    { jp: '超えない', cn: '不超过' },
    { jp: 'ください', cn: '' },
    { jp: 'マップ', cn: '贴图' },
    { jp: 'チャンネル', cn: '通道' },
    { jp: 'する', cn: '' },
    { jp: 'します', cn: '' },
    { jp: 'した', cn: '' },
    { jp: 'です', cn: '' },
    { jp: 'ます', cn: '' },
    { jp: 'の', cn: '的' },
    { jp: 'を', cn: '' },
    { jp: 'が', cn: '' },
    { jp: 'は', cn: '' },
    { jp: 'に', cn: '' },
    { jp: 'で', cn: '' },
    { jp: 'と', cn: '' },
    { jp: 'も', cn: '' },
    { jp: 'へ', cn: '' },
    { jp: 'や', cn: '' },
    { jp: 'ね', cn: '' },
    { jp: 'よ', cn: '' }
  ],
  授权与声明: [
    { jp: '著作権', cn: '著作权' },
    { jp: '作者', cn: '作者' },
    { jp: '制作者', cn: '制作者' },
    { jp: '改変', cn: '修改' },
    { jp: '改造', cn: '改造' },
    { jp: '再配布', cn: '再发布' },
    { jp: '配布', cn: '发布' },
    { jp: '転載', cn: '转载' },
    { jp: '無断', cn: '未经许可' },
    { jp: '禁止', cn: '禁止' },
    { jp: '許可', cn: '许可' },
    { jp: '自由', cn: '自由' },
    { jp: '自己責任', cn: '自行承担' },
    { jp: '免責', cn: '免责' },
    { jp: '連絡', cn: '联系' },
    { jp: '不要', cn: '不需要' },
    { jp: 'お願い', cn: '拜托' },
    { jp: '感謝', cn: '感谢' },
    { jp: '謝辞', cn: '致谢' },
    { jp: '更新履歴', cn: '更新记录' },
    { jp: '不具合', cn: '故障' },
    { jp: '修正', cn: '修正' },
    { jp: '確認', cn: '确认' },
    { jp: '検証', cn: '验证' },
    { jp: '仕様', cn: '规格' },
    { jp: '対応', cn: '适配' },
    { jp: '非対応', cn: '不支持' },
    { jp: '推奨', cn: '推荐' }
  ]
};

/** 平表，长的在前 —— 贪最长匹配靠这个顺序 */
export const BUILTIN: GlossaryEntry[] = Object.values(GROUPS)
  .flat()
  .sort((a, b) => b.jp.length - a.jp.length);

export const GROUP_NAMES = Object.keys(GROUPS);

export function groupOf(jp: string): string {
  for (const [name, list] of Object.entries(GROUPS)) {
    if (list.some((e) => e.jp === jp)) return name;
  }
  return '自定义';
}

export type TermHit = { jp: string; cn: string; count: number };

export type TranslateResult = {
  /** 替换之后的文本 */
  text: string;
  /** 命中的词条和次数 */
  hits: TermHit[];
  /** 没被任何词条覆盖的日文片段（去重，最长的前几个放前面） */
  uncovered: string[];
  /** 覆盖比例：被替换掉的假名/汉字字符数 ÷ 全部假名汉字字符数 */
  coverage: number;
};

const KANA_KANJI =
  /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF]/;

/**
 * 按词表替换。
 *
 * 做法是最长优先的贪心匹配：从当前位置开始，拿表里最长的能对上的词条替换掉。
 * 词表已经按长度排过序，所以「半透明」一定先于「透明」被匹配到。
 *
 * 没对上的片段原样留着，并且收集起来 —— 界面要把它们列出来，
 * 让人知道哪些是自己要补进词表的。
 */
export function translateWith(
  text: string,
  table: GlossaryEntry[]
): TranslateResult {
  const sorted = [...table].sort((a, b) => b.jp.length - a.jp.length);
  const counts = new Map<string, number>();
  let out = '';
  let i = 0;
  let coveredChars = 0;
  const uncovered: string[] = [];

  while (i < text.length) {
    let matched: GlossaryEntry | null = null;
    for (const e of sorted) {
      if (e.jp && text.startsWith(e.jp, i)) {
        matched = e;
        break;
      }
    }
    if (matched) {
      out += matched.cn;
      counts.set(matched.jp, (counts.get(matched.jp) ?? 0) + 1);
      coveredChars += matched.jp.length;
      i += matched.jp.length;
    } else {
      // 攒一段没命中的日文，碰到下一个命中点或者非日文就收尾
      let j = i;
      while (j < text.length) {
        if (KANA_KANJI.test(text[j])) {
          let hit = false;
          for (const e of sorted) {
            if (e.jp && text.startsWith(e.jp, j)) {
              hit = true;
              break;
            }
          }
          if (hit) break;
        }
        j++;
      }
      const chunk = text.slice(i, j);
      out += chunk;
      if (KANA_KANJI.test(chunk) && chunk.trim()) uncovered.push(chunk.trim());
      i = j;
    }
  }

  // 分母：原文里的假名汉字总数
  let total = 0;
  for (const ch of text) if (KANA_KANJI.test(ch)) total++;

  return {
    text: out,
    hits: [...counts.entries()]
      .map(([jp, count]) => ({ jp, cn: sorted.find((e) => e.jp === jp)?.cn ?? '', count }))
      .sort((a, b) => b.count - a.count || a.jp.localeCompare(b.jp)),
    uncovered: [...new Set(uncovered)]
      .sort((a, b) => b.length - a.length)
      .slice(0, 40),
    coverage: total ? coveredChars / total : 0
  };
}

/* ---------------------------------------------------------------- 用户词表 */

const KEY = 'robin.glossary';

/** 读用户自己加的词条。格式跟内置的一样。 */
export function loadUserTable(): GlossaryEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (e) => e && typeof e.jp === 'string' && typeof e.cn === 'string' && e.jp
    );
  } catch {
    return [];
  }
}

export function saveUserTable(list: GlossaryEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* 存不下就算了，不影响当前这次翻译 */
  }
}

/** 用户词条 + 内置，用户的后加所以优先 */
export function mergeTable(user: GlossaryEntry[]): GlossaryEntry[] {
  return [...user, ...BUILTIN];
}
