// One-off: cuts the eight scenic pictures out of the ChatGPT skin poster as STAND-IN artwork.
// They are only ~270px wide, so replace them with the real files (same names) when you have them.
//   node scripts/crop-poster-art.mjs "<path to poster.png>"
import sharp from "sharp";

const poster = process.argv[2];
// left, top, width, height in the 1536x1024 poster
const crops = {
  "forest-trail": {
    "pick-hero": [1241, 43, 270, 121],
    "browse-banner": [1241, 193, 270, 66],
    "empty-state": [1241, 294, 144, 134],
    onboarding: [1412, 280, 92, 180],
  },
  "cozy-cabin": {
    "pick-hero": [1241, 545, 270, 109],
    "browse-banner": [1241, 701, 270, 66],
    "empty-state": [1241, 802, 144, 134],
    onboarding: [1412, 788, 92, 180],
  },
};
for (const [skin, files] of Object.entries(crops)) {
  for (const [name, [left, top, width, height]] of Object.entries(files)) {
    await sharp(poster)
      .extract({ left, top, width, height })
      .resize({ width: width * 4, kernel: "lanczos3" })
      .sharpen({ sigma: 1.1 })
      .jpeg({ quality: 82, mozjpeg: true })
      .toFile(`public/skins/${skin}/${name}.jpg`);
    console.log(`public/skins/${skin}/${name}.jpg`);
  }
}
