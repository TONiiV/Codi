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
  float gust = sin(imageUv.x * 12.0 + imageUv.y * 7.0 - uTime * 2.3);
  gust += 0.4 * sin(imageUv.x * 23.0 - imageUv.y * 12.0 + uTime * 1.6);
  imageUv += vec2(0.014 * gust, 0.005 * sin(imageUv.x * 10.0 - uTime * 1.8));
  imageUv = clamp(imageUv, 0.001, 0.999);
  float brightness = luma(texture(uImage, imageUv).rgb);
  float gx = luma(texture(uImage, imageUv + vec2(0.004, 0.0)).rgb) - brightness;
  float gy = luma(texture(uImage, imageUv + vec2(0.0, 0.004)).rgb) - brightness;
  float direction = atan(gx, -gy) + 0.22 * gust;
  float bin = mod(floor(direction * 8.0 / 3.14159265 + 0.5), 8.0);
  float weight = brightness < 0.12 ? 0.0 : brightness < 0.3 ? 1.0 : brightness < 0.55 ? 2.0 : 3.0;
  float glyphIndex = length(vec2(gx, gy)) < 0.008 && brightness < 0.16
    ? 0.0 : 1.0 + weight * 8.0 + bin;
  float glyph = texture(uGlyphs, vec2((glyphIndex + uv.x) / uGlyphCount, uv.y)).r;
  vec3 base = mix(uNight, uBlue, brightness * 0.7);
  vec3 ink = mix(uNight, uBlue, clamp(0.35 + brightness * 0.9, 0.0, 1.0));
  vec3 col = mix(base, ink, glyph * 0.65);
  fragColor = vec4(col, 1.0);
}
