import sharp from 'sharp';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = dirname(fileURLToPath(import.meta.url));
const svg = await readFile(resolve(appRoot, '../../web/public-herdr/openherdr.svg'));
const background = '#fffdf4';

await sharp(svg).resize(1024, 1024).flatten({ background }).png().toFile(
  resolve(appRoot, 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'),
);

const densities = [['mdpi', 1], ['hdpi', 1.5], ['xhdpi', 2], ['xxhdpi', 3], ['xxxhdpi', 4]];
await Promise.all(densities.map(async ([density, scale]) => {
  const directory = resolve(appRoot, `android/app/src/main/res/mipmap-${density}`);
  const icon = await sharp(svg).resize(48 * scale, 48 * scale).png().toBuffer();
  await Promise.all(['ic_launcher.png', 'ic_launcher_round.png'].map(filename =>
    sharp(icon).toFile(resolve(directory, filename)),
  ));
  const foreground = await sharp(svg).resize(66 * scale, 66 * scale).png().toBuffer();
  await sharp({ create: { width: 108 * scale, height: 108 * scale, channels: 4, background: '#00000000' } })
    .composite([{ input: foreground, gravity: 'centre' }]).png()
    .toFile(resolve(directory, 'ic_launcher_foreground.png'));
}));

const splashRoots = [resolve(appRoot, 'ios/App/App/Assets.xcassets/Splash.imageset')];
const resourceRoot = resolve(appRoot, 'android/app/src/main/res');
for (const entry of await readdir(resourceRoot, { withFileTypes: true })) {
  if (entry.isDirectory() && entry.name.startsWith('drawable')) splashRoots.push(resolve(resourceRoot, entry.name));
}
for (const directory of splashRoots) {
  for (const filename of await readdir(directory)) {
    if (!filename.startsWith('splash') || !filename.endsWith('.png')) continue;
    const file = resolve(directory, filename);
    const { width, height } = await sharp(file).metadata();
    if (!width || !height) throw new Error(`Missing image dimensions: ${file}`);
    const size = Math.round(Math.min(width, height) / 4);
    const mark = await sharp(svg).resize(size, size).png().toBuffer();
    const output = await sharp({ create: { width, height, channels: 3, background } })
      .composite([{ input: mark, gravity: 'centre' }]).png().toBuffer();
    await sharp(output).toFile(file);
  }
}
console.log('OpenHerdr native icons and launch images generated from public-herdr/openherdr.svg.');
