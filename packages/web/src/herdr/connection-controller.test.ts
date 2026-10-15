import { expect, test } from 'bun:test';
import { HerdrConnectionController } from './connection-controller';
import { type Connection, type Pairing } from './transport';

const one = { pairingId: 'first', secret: 'one-use-first', server: 'https://first.test' };
const two = { pairingId: 'second', secret: 'one-use-second', server: 'https://second.test' };
const link = (payload: Pairing, origin = payload.server) => `${origin}/#pairing=${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function fixture(initialPairing: Pairing | null = one) {
  const activations: Connection[] = [];
  const redemptions: { server: string; pairing: Pairing }[] = [];
  const writes: Connection[] = [];
  let saved: Connection[] = [{ server: 'https://saved.test', token: 'existing-device' }];
  let initialize = async () => {};
  let save = async (connection: Connection) => { saved = [connection, ...saved.filter(item => item.server !== connection.server)]; };
  let redeem = async (server: string, _pairing: Pairing): Promise<Connection> => ({ server, token: 'new-device' });
  const controller = new HerdrConnectionController({
    initialize: () => initialize(), list: () => saved,
    async redeem(server, pairing) { redemptions.push({ server, pairing }); return redeem(server, pairing); },
    async save(connection) { writes.push(connection); await save(connection); },
  }, connection => activations.push(connection), { server: initialPairing?.server ?? '', pairing: initialPairing, error: null });
  return { controller, activations, redemptions, writes,
    initializeWith: (operation: typeof initialize) => { initialize = operation; },
    saveWith: (operation: typeof save) => { save = operation; },
    redeemWith: (operation: typeof redeem) => { redeem = operation; },
  };
}
test('intake previews both CLI and native links without redeeming', () => {
  const f = fixture(null);
  f.controller.acceptLink(link(one));
  expect(f.controller.getSnapshot().server).toBe(one.server);
  const encoded = Buffer.from(JSON.stringify(two)).toString('base64url');
  f.controller.acceptLink(`openherdr://connect#pairing=${encoded}`);
  expect(f.controller.getSnapshot().pairing).toEqual(two);
  expect(f.redemptions).toHaveLength(0); expect(f.writes).toHaveLength(0);
});
test('invalid or mismatched QR protocols never dispatch', async () => {
  for (const value of ['https://first.test', 'openchamber://connect?v=2&p=e30', 'https://first.test/?token=private', link(one, two.server), link({ ...one, server: 'http://first.test' }), '#pairing=e30']) {
    const f = fixture(null); f.controller.acceptLink(value);
    await f.controller.connect();
    expect(f.controller.getSnapshot().error).toBeTruthy();
    expect(f.redemptions).toHaveLength(0); expect(f.writes).toHaveLength(0);
  }
});
test('double confirmation uses one captured server/payload and waits for persistence', async () => {
  const f = fixture(); const saved = deferred<void>(); f.saveWith(() => saved.promise);
  const first = f.controller.connect(); const duplicate = f.controller.connect();
  f.controller.setServer(two.server); f.controller.setPairingText(link(two));
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  expect(f.redemptions).toEqual([{ server: one.server, pairing: one }]);
  expect(f.activations).toHaveLength(0);
  saved.resolve(); await Promise.all([first, duplicate]);
  expect(f.activations).toEqual([{ server: one.server, token: 'new-device' }]); expect(f.writes).toHaveLength(1);
});
test('an unreadable vault prevents consumption, including after a new link', async () => {
  const f = fixture(); f.initializeWith(async () => { throw new Error('Vault locked'); });
  f.controller.acceptLink(link(two)); await f.controller.connect();
  expect(f.controller.getSnapshot().error).toBe('credentialStorage');
  expect(f.redemptions).toHaveLength(0); expect(f.writes).toHaveLength(0);
});
test('confirmed redemption retries only the failed credential save', async () => {
  const f = fixture(); let fail = true;
  f.saveWith(async () => { if (fail) throw new Error('Vault unavailable'); });
  await f.controller.connect();
  expect(f.controller.getSnapshot().phase).toBe('save-failed'); expect(f.activations).toHaveLength(0);
  fail = false; await f.controller.connect();
  expect(f.redemptions).toHaveLength(1); expect(f.writes).toHaveLength(2); expect(f.activations).toHaveLength(1);
});
test('new intent during redemption stays pending after the old credential is saved', async () => {
  const f = fixture(); const response = deferred<Connection>(); f.redeemWith(() => response.promise);
  const pending = f.controller.connect(); await Promise.resolve(); await Promise.resolve();
  f.controller.acceptLink(link(two));
  response.resolve({ server: one.server, token: 'first-device' }); await pending;
  expect(f.writes).toEqual([{ server: one.server, token: 'first-device' }]);
  expect(f.activations).toHaveLength(0); expect(f.controller.getSnapshot().pairing).toEqual(two);
  await f.controller.connect();
  expect(f.redemptions).toHaveLength(2); expect(f.redemptions[1]?.server).toBe(two.server);
});
test('a newer queued intent survives save failure and save-only retry', async () => {
  const f = fixture(); let fail = true; f.saveWith(async () => { if (fail) throw new Error('Unavailable'); });
  const pending = f.controller.connect(); f.controller.acceptLink(link(two)); await pending;
  expect(f.controller.getSnapshot().pairing).toEqual(one);
  fail = false; await f.controller.connect();
  expect(f.redemptions).toHaveLength(1); expect(f.controller.getSnapshot().pairing).toEqual(two); expect(f.activations).toHaveLength(0);
});
test('saved selection persists ordering and activates without redemption', async () => {
  const f = fixture(); const gate = deferred<void>(); f.saveWith(() => gate.promise);
  const pending = f.controller.selectSaved('https://saved.test');
  await f.controller.selectSaved('https://saved.test'); expect(f.activations).toHaveLength(0);
  gate.resolve(); await pending;
  expect(f.redemptions).toHaveLength(0); expect(f.writes).toHaveLength(1); expect(f.activations[0]?.token).toBe('existing-device');
});
test('unmount permits captured persistence but prevents a late navigation callback', async () => {
  const f = fixture(); const gate = deferred<void>(); f.saveWith(() => gate.promise);
  const pending = f.controller.connect(); f.controller.setActive(false); gate.resolve(); await pending;
  expect(f.writes).toHaveLength(1); expect(f.activations).toHaveLength(0);
});
test('failed redemption is not retried or treated as a saved connection', async () => {
  const f = fixture(); f.redeemWith(async () => { throw new Error('Connection reset'); });
  await f.controller.connect();
  expect(f.redemptions).toHaveLength(1); expect(f.writes).toHaveLength(0); expect(f.activations).toHaveLength(0);
  expect(f.controller.getSnapshot().error).toBe('Connection reset');
});

test('a rejected saved credential cannot activate or be saved again', async () => {
  const f = fixture(null);
  const revoked = { server: 'https://saved.test', token: 'existing-device' };
  f.controller.requireAuthentication(revoked, false);
  expect(f.controller.getSnapshot().authRequiredServer).toBe(revoked.server);
  expect(f.controller.getSnapshot().server).toBe(revoked.server);
  await f.controller.selectSaved(revoked.server);
  expect(f.writes).toHaveLength(0);
  expect(f.activations).toHaveLength(0);
  expect(f.controller.getSnapshot().saved).toEqual([revoked]);
});

test('replacement authentication persists before activation and retries only saving', async () => {
  const f = fixture(null);
  const revoked = { server: one.server, token: 'old-device' };
  f.controller.requireAuthentication(revoked, false);
  f.controller.acceptLink(link(one));
  let fail = true;
  f.saveWith(async () => { if (fail) throw new Error('Unavailable'); });
  await f.controller.connect();
  expect(f.controller.getSnapshot().phase).toBe('save-failed');
  expect(f.controller.isRejected(revoked)).toBe(true);
  expect(f.activations).toHaveLength(0);
  fail = false; await f.controller.connect();
  expect(f.redemptions).toHaveLength(1);
  expect(f.writes).toHaveLength(2);
  expect(f.activations).toEqual([{ server: one.server, token: 'new-device' }]);
  expect(f.controller.getSnapshot().authRequiredServer).toBe(null);
});

test('authentication failure preserves a newer visible intent and a confirmed save retry', async () => {
  const f = fixture();
  f.controller.acceptLink(link(two));
  f.controller.requireAuthentication({ server: one.server, token: 'old-device' }, true);
  expect(f.controller.getSnapshot().pairing).toEqual(two);
  f.saveWith(async () => { throw new Error('Unavailable'); });
  await f.controller.connect();
  f.controller.requireAuthentication({ server: two.server, token: 'older-device' }, false);
  expect(f.controller.getSnapshot().phase).toBe('save-failed');
  f.saveWith(async () => {}); await f.controller.connect();
  expect(f.redemptions).toHaveLength(1);
  expect(f.activations).toEqual([{ server: two.server, token: 'new-device' }]);
});

test('a rejected saved selection settles the latest queued link without activating the old credential', async () => {
  const f = fixture(null);
  const gate = deferred<void>(); f.saveWith(() => gate.promise);
  const pending = f.controller.selectSaved('https://saved.test');
  f.controller.acceptLink(link(two));
  f.controller.requireAuthentication({ server: 'https://saved.test', token: 'existing-device' }, true);
  gate.resolve(); await pending;
  expect(f.activations).toHaveLength(0);
  expect(f.controller.getSnapshot().pairing).toEqual(two);
  f.saveWith(async () => {}); await f.controller.connect();
  expect(f.activations).toEqual([{ server: two.server, token: 'new-device' }]);
  expect(f.controller.getSnapshot().pairing).toBe(null);
});

test('saving a replacement with a newer queued intent keeps the current revoked token blocked', async () => {
  const f = fixture(null);
  const revoked = { server: one.server, token: 'old-device' };
  f.controller.requireAuthentication(revoked, false);
  f.controller.acceptLink(link(one));
  const gate = deferred<void>(); f.saveWith(() => gate.promise);
  const pending = f.controller.connect();
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  f.controller.acceptLink(link(two));
  gate.resolve(); await pending;
  expect(f.activations).toHaveLength(0);
  expect(f.controller.isRejected(revoked)).toBe(true);
  expect(f.controller.isRejected({ server: one.server, token: 'new-device' })).toBe(false);
  expect(f.controller.getSnapshot().authRequiredServer).toBe(one.server);
  expect(f.controller.getSnapshot().pairing).toEqual(two);
});
