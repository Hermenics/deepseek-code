---
name: generate-png-images
description: Generate real PNG files with local code, without an image API, using the tools and libraries available in the environment.
metadata:
  version: 1.0.0
---

# Generate PNG images locally

Use this skill when the user asks to create, draw, render, edit, or generate an
image, PNG, icon, logo, banner, poster, thumbnail, card, diagram, chart, or
visual pattern.

## Important limitation

This is a **programmatic rendering** skill, not an AI image-generation model.
It does not call image APIs and does not require an image-generation key. The
DeepSeek Code agent still needs a configured LLM provider, unless it is using a
local provider.

For photographs or complex prompt-based artwork, briefly explain that a local
image model such as Stable Diffusion, Flux, or ComfyUI is required. Do not
pretend that Pillow replaces such a model.

## Required workflow

1. Understand the visual goal, aspect ratio, dimensions, background, focal
   point, palette, text, and style. Choose sensible defaults when details are
   missing.
2. Choose the smallest suitable implementation:
   - **Pillow** for raster illustrations, icons, cards, banners, and compositing;
   - **Matplotlib** for charts and numerical visualizations;
   - **NumPy + Pillow** for gradients, textures, noise, and procedural patterns;
   - **OpenCV** only when image processing or computer-vision transforms are
     actually needed;
   - **ImageMagick** as a simple fallback when Pillow is unavailable.
3. Check capabilities before execution. Use `python3`/Pillow when already
   available; do not silently install packages or require a heavy dependency
   when an available tool is sufficient.
4. If the best implementation requires a missing dependency, stop before
   installing it and ask the user for explicit authorization. State the exact
   dependency, why it is needed, the proposed install command, and whether the
   installation changes the system or only the project environment. Do not
   interpret a request to generate an image as permission to install software.
   If the user declines, use an available fallback or provide an executable
   script without claiming that the image was created.
5. Generate the real file in the current project path unless the user specifies
   another location. Prefer a descriptive filename with the `.png` extension.
6. Validate the result: confirm that the file exists and is non-empty, that it
   is a readable PNG, and that its dimensions, color mode, and transparency
   are correct. Use `PIL.Image.verify()` or `identify`/`file` when available.
7. Inspect the image visually when the environment provides a viewer. Without
   one, perform technical validation and do not claim visual inspection.
8. If an obvious problem appears, fix the code and render again before
   delivering. Never claim to have created a file that does not exist or open.

## Quality rules

- Respect requested dimensions and aspect ratio. When unspecified, use a
  moderate resolution appropriate for the asset type.
- Use RGBA and a transparent background for icons, logos, stickers, and
  isolated elements when appropriate. Use an opaque background for posters,
  banners, thumbnails, and complete illustrations.
- Preserve visual hierarchy: focal point, contrast, margins, alignment, and
  breathing room. For text, check the font, bounding box, contrast, and
  clipping.
- Use layers, masks, alpha, blur, and supersampling only when they improve the
  result. Do not use SVG as an intermediate step without a concrete reason.
- Use a fixed random seed during iteration and change it only when the user
  requests variations.
- Do not generate huge Base64 payloads, construct PNG bytes manually, or dump
  a Python tutorial. Deliver the PNG and show complete code only when asked.

## Output

Provide a link or path to the real PNG and briefly report its dimensions and
format. If the environment has no tool capable of generating the image, explain
the blocker and provide the smallest executable script possible without
claiming that the image was already created.
