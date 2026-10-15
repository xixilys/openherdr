import { expect, test } from 'bun:test';
import { listenForHerdrPairingUrls } from './herdr-native';

function fixture() {
  let receive: (event: { url: string }) => void = () => undefined;
  let finishLaunch: (value: { url: string } | undefined) => void = () => undefined;
  const launch = new Promise<{ url: string } | undefined>(resolve => { finishLaunch = resolve; });
  let removes = 0;
  const received: string[] = [];
  const cleanup = listenForHerdrPairingUrls({
    async addListener(_name, listener) { receive = listener; return { async remove() { removes++; } }; },
    getLaunchUrl() { return launch; },
  }, url => received.push(url));
  return { received, finishLaunch, receive: (url: string) => receive({ url }), cleanup, removes: () => removes };
}
test('a newer warm link suppresses a late cold-launch result', async () => {
  const f = fixture();
  await Promise.resolve();
  f.receive('openherdr://connect#warm');
  f.finishLaunch({ url: 'openherdr://connect#old' });
  await Promise.resolve(); await Promise.resolve();
  expect(f.received).toEqual(['openherdr://connect#warm']);
  f.cleanup(); expect(f.removes()).toBe(1);
});
test('cold launch is delivered once, then warm links remain available', async () => {
  const f = fixture(); f.finishLaunch({ url: 'openherdr://connect#cold' });
  await Promise.resolve(); await Promise.resolve();
  f.receive('openherdr://connect#new');
  expect(f.received).toEqual(['openherdr://connect#cold', 'openherdr://connect#new']);
  f.cleanup();
});
test('unmount removes a listener registered late and ignores URL results', async () => {
  const f = fixture(); f.cleanup(); f.receive('openherdr://connect#warm');
  f.finishLaunch({ url: 'openherdr://connect#cold' });
  await Promise.resolve(); await Promise.resolve();
  expect(f.received).toEqual([]); expect(f.removes()).toBe(1);
});
