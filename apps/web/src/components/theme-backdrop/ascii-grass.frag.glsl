#version 300 es
precision highp float;
uniform vec2 uRes; uniform float uTime;
uniform vec2 uGrid;
uniform vec3 uNight; uniform vec3 uBlue;
uniform sampler2D uImage;
uniform sampler2D uGlyphs; uniform float uGlyphCount;
out vec4 fragColor;
float luma(vec3 color){ return dot(color, vec3(0.2126, 0.7152, 0.0722)); }
void main(){
  vec2 cell = gl_FragCoord.xy / uRes * uGrid;
  vec2 id = floor(cell);
  vec2 uv = fract(cell);
  float imageAspect = 640.0 / 1050.0;
  float viewAspect = uRes.x / uRes.y;
  vec2 crop = viewAspect > imageAspect
    ? vec2(1.0, imageAspect / viewAspect)
    : vec2(viewAspect / imageAspect, 1.0);
  vec2 imageUv = ((id + 0.5) / uGrid - 0.5) * crop + 0.5;
  float gust = sin(imageUv.x * 9.0 + imageUv.y * 5.0 - uTime * 2.0);
  gust += 0.35 * sin(imageUv.x * 21.0 - imageUv.y * 11.0 + uTime * 1.5);
  imageUv += vec2(0.008 * gust, 0.003 * sin(imageUv.x * 11.0 - uTime * 1.6));
  imageUv = clamp(imageUv, 0.001, 0.999);
  float brightness = luma(texture(uImage, imageUv).rgb);
  float gx = luma(texture(uImage, imageUv + vec2(0.004, 0.0)).rgb) - brightness;
  float gy = luma(texture(uImage, imageUv + vec2(0.0, 0.004)).rgb) - brightness;
  float direction = atan(gx, -gy) + 0.28 * gust;
  float bin = mod(floor(direction * 8.0 / 3.14159265 + 0.5), 8.0);
  float tone = smoothstep(0.07, 0.82, brightness);
  float weight = tone < 0.14 ? 0.0 : tone < 0.4 ? 1.0 : tone < 0.7 ? 2.0 : 3.0;
  float glyphIndex = length(vec2(gx, gy)) < 0.008 && brightness < 0.16
    ? 0.0 : 1.0 + weight * 8.0 + bin;
  float glyph = texture(uGlyphs, vec2((glyphIndex + uv.x) / uGlyphCount, uv.y)).r;
  vec3 base = mix(uNight, uBlue, tone * 0.24);
  vec3 ink = mix(uNight, uBlue, 0.12 + tone * 0.82);
  vec3 col = mix(base, ink, glyph * 0.78);
  fragColor = vec4(col, 1.0);
}
