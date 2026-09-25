// テクスチャの設定
// コントローラーから受け取る
#define TEXTURE_SWIZZLE 3
float4 main(float2 uv : TEXCOORD0) : COLOR0 {
  // シェーダーの本体
  float4 c = tex2D(TextureSampler, uv);
  /* メタリック成分を足す */
  return c; // ここで返す
}
