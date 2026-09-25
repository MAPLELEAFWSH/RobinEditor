// 僥僋僗僠儍偺愝掕
// 僐儞僩儘乕儔乕偐傜庴偗庢傞
#define TEXTURE_SWIZZLE 3
float4 main(float2 uv : TEXCOORD0) : COLOR0 {
  // 僔僃乕僟乕偺杮懱
  float4 c = tex2D(TextureSampler, uv);
  /* 儊僞儕僢僋惉暘傪懌偡 */
  return c; // 偙偙偱曉偡
}
