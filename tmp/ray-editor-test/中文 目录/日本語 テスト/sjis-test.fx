////////////////////////////////////////////////////////////////////////////////////////////////
//　NCHLShader2 Basic.fx マットな質感の汎用プリセット
// 
////////////////////////////////////////////////////////////////////////////////////////////////

// 共通パラメータ読込
#include "CommonParams.fxh"

// 陰影の濃さ　いわゆる美白ライト効果 値が小さいほど陰が飛びます
#define SHADING_MIN 1   // -0.5～0.0
#define SHADING_MAX 1.3   // 1.0～2.0

// スペキュラのパラメータ　表面の粗さと反射率
#define ROUGHNESS 1.0
#define FRESNEL 1.0

// スペキュラ強度補正　スペキュラマップ使用時は少し大きめにしたほうがいいかも
#define SPECULAR_EXTENT 0.1 

// でたらめ光沢の強さ
// 0で無効，1より大きいとメタリック
#define GLOSS_EXTENT 0
#define GLOSS_TYPE comp*(saturate(0.5-(1-G)*(1+G_I)))*GLOSS_EXTENT*2

// 超適当異方性反射風 髪以外では余り使い物にならない
//#define GLOSS_TYPE (saturate(0.5-(G_I/NV)*(NV+G_I)))*GLOSS_EXTENT

// リムライト強度
#define RIM_STRENGTH 0.5 

// 表面下散乱のパラメータ
#define SUBDEPTH 5                 //　透ける量
#define SUBCOLOR MaterialToon.rgb  //　透ける色

// シェーダ本体の読み込み
#include "Main.fxh"