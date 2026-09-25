/**
 * 关于页的个人主页入口。
 *
 * 地址集中放这儿，改一处就够。图标名走 src/lib/icons.ts（brand.* 那三个
 * 是 simple-icons 来的，MDI 不收厂商 logo）。
 */

export type SocialLink = {
  /** icons.ts 里的键 */
  icon: string;
  /** 显示名 */
  label: string;
  /** 副标题，放 ID */
  handle: string;
  href: string;
  /** 无障碍名，读屏用 */
  title: string;
};

export const SOCIAL: SocialLink[] = [
  {
    icon: 'brand.bilibili',
    label: '哔哩哔哩',
    handle: '514431153',
    href: 'https://space.bilibili.com/514431153',
    title: '在哔哩哔哩打开我的主页'
  },
  {
    icon: 'brand.github',
    label: 'GitHub',
    handle: 'MAPLELEAFWSH',
    href: 'https://github.com/MAPLELEAFWSH',
    title: '在 GitHub 打开我的主页'
  }
];
