'use strict';
// Valid minimal ai_asset STYLE output for transport tests. Not a real vision-model judgment.
const styleOutput=`\`\`\`yaml
# Style DNA: 深蓝金属与切角按钮
version: 1.0
project:
  genre: [strategy]
  platform: mobile
style:
  rendering: semi_painted
shape:
  language: angular
  corner_radius: small
  ui_panel_geometry: square_chunky
palette:
  primary: ["#182E46"]
  secondary: ["#294F6D"]
  accent: ["#F6C154"]
  neutral: ["#EBF4F4"]
  danger: ["#A33D3D"]
color_map:
  panel: ["#182E46", "#294F6D"]
  button_primary: ["#294F6D", "#F6C154"]
material:
  button: metallic
  container: metal_frame
camera: orthographic
canvas:
  orientation: portrait
  aspect_ratio: "9:16"
negative: [pastel_palette, overly_rounded_plastic]
confidence:
  rendering: 0.85
  shape: 0.9
  palette: 0.8
  color_map: 0.78
\`\`\`
# REVIEW NOTES
# CONSISTENCY: bg=#182E46 reads dark; shape measured square, no conflicting negatives`;
module.exports={styleOutput};
