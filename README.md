# PDF → XTC

Convert two-column PDFs to **XTC / XTCH** files for **XTEink X4 / X3** e-readers.

Unlike a plain full-page conversion, each text column becomes its own
full-screen page — so a two-column book stays readable on a 480×800 e-ink
display. Everything runs locally in your browser: no uploads, no server.

## Features

- **Automatic column detection** per page (vertical whitespace projection).
  Pages without a reliable gutter (covers, images) stay full-page.
- **Per-page overrides**: force full page / 2 columns, drag the split line.
- **Auto-crop** of white margins to maximize text size.
- Live side-by-side preview: original page vs. real 1-bit/2-bit device output.
- Options: XTC (1-bit) / XTCH (2-bit grayscale), contrast, text darkness,
  dithering, crop padding, device (X4 / X3), page range.
- Single-click export and download; title/author metadata embedded.

## Development

```sh
npm install
npm run dev      # local dev server
npm run build    # typecheck + production build in dist/
```

## Credits

The XTC/XTCH/XTG/XTH encoders and the quantization pipeline are adapted from
[xtcjs](https://github.com/varo6/xtcjs) by varo6, MIT License.
PDF rendering by [pdf.js](https://mozilla.github.io/pdf.js/).

## License

MIT
