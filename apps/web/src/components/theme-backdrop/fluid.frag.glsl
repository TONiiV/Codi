#version 300 es
precision highp float;
uniform vec2 uRes; uniform float uTime;
uniform vec3 uNight; uniform vec3 uBlue; uniform vec3 uGlow;
out vec4 fragColor;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1, 0)), c = hash(i + vec2(0, 1)), d = hash(i + vec2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p){
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 6; ++i) { s += a * noise(p); p *= 2.0; a *= 0.5; }
  return s;
}
void main(){
  vec2 p = gl_FragCoord.xy / uRes.y * 3.0;
  float t = uTime;
  vec2 q = vec2(fbm(p + 0.15 * t), fbm(p + 5.2 - 0.12 * t));
  vec2 p1 = p + 4.0 * q;
  vec2 r = vec2(fbm(p1 + 1.7), fbm(p1 + 9.2));
  float v = fbm(p1 + 4.0 * r + 0.5 * t);
  vec3 col = mix(uNight, uBlue, v);
  col = mix(col, uGlow, smoothstep(0.55, 1.05, length(q)));
  fragColor = vec4(col, 1.0);
}
