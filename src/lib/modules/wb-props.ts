/** 功能页统一传进来的东西。tools/[id] 里 <PanelComp panelId={cur} /> */
export type WbProps = {
  /** 当前分区 id，来自注册表的 panels[].id */
  panelId?: string;
};
