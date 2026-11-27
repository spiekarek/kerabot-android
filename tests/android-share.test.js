'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const app = readFileSync(join(__dirname, '../www/app.js'), 'utf8');
const key = 'kerabot_offline_outbox_v1';

async function openInbox({ items = [], batches = [], blockWrites = false, blockAck = false } = {}) {
  const data = new Map([[key, JSON.stringify(items)]]);
  const statuses = new Map();
  const pending = [...batches];
  const failures = { write: blockWrites, ack: blockAck };
  const appNode = {
    classList: { toggle() {}, add() {} },
    style: {},
    textContent: '',
    querySelectorAll: () => [],
    addEventListener() {},
    setAttribute() {},
  };
  const document = {
    body: appNode,
    documentElement: appNode,
    getElementById(id) {
      if (id === 'outbox-status') {
        return { set textContent(value) { statuses.set(id, value); } };
      }
      return { ...appNode };
    },
    querySelectorAll: () => [],
  };
  const localStorage = {
    getItem: (name) => data.get(name) ?? null,
    setItem(name, value) {
      if (name === key && failures.write) throw new Error('QuotaExceededError');
      data.set(name, value);
    },
  };
  const window = {
    location: { hash: '' },
    addEventListener() {},
    SebaPendingShare: {
      postMessage(request) {
        const end = request.indexOf("\n");
        const prefix = request.slice(0, end + 1);
        const operation = request.slice(end + 1);
        let response;
        if (operation === "peek") {
          response = pending.length ? JSON.stringify(pending[0]) : "";
        } else {
          const acknowledged = !failures.ack && operation === "ack:" + pending[0]?.id;
          if (acknowledged) pending.shift();
          response = String(acknowledged);
        }
        queueMicrotask(() => {
          this.onmessage?.({ data: "0\nSpóźniona odpowiedź" });
          this.onmessage?.({ data: prefix + response });
        });
      },
    },
  };
  vm.runInNewContext(app, {
    document, window, localStorage,
    navigator: { onLine: true },
    fetch: async () => { throw new Error('offline'); },
    setTimeout() {}, clearTimeout() {},
  });
  await new Promise(setImmediate);
  return {
    items: () => JSON.parse(data.get(key)),
    status: () => statuses.get('outbox-status') ?? '',
    pending,
    failures,
    retry: () => window.SebaConsumePendingShare(),
  };
}

const sample = { id: 'one', items: [{ text: 'Z galerii', photo: 'data:image/jpeg;base64,AA==' }] };

test('błąd zapisu zachowuje całą kolejkę i paczkę oraz pozwala zapisać później', async () => {
  const original = [{ id: 7, text: 'starszy wpis' }];
  const inbox = await openInbox({ items: original, batches: [sample], blockWrites: true });
  assert.deepEqual(inbox.items(), original);
  assert.equal(inbox.pending.length, 1);
  assert.match(inbox.status(), /Paczka czeka/);
  inbox.failures.write = false;
  assert.equal(await inbox.retry(), 1);
  assert.equal(inbox.pending.length, 0);
  assert.equal(inbox.items()[0].photo, sample.items[0].photo);
  assert.equal(inbox.items()[1].id, 7);
});

test('ponowienie po nieudanym potwierdzeniu nie dubluje wpisu', async () => {
  const inbox = await openInbox({ batches: [sample], blockAck: true });
  assert.equal(inbox.items().length, 1);
  assert.equal(inbox.pending.length, 1);
  inbox.failures.ack = false;
  assert.equal(await inbox.retry(), 0);
  assert.equal(inbox.items().length, 1);
  assert.equal(inbox.pending.length, 0);
});

test('pełny Inbox pozostawia wszystkie wpisy i zmieści paczkę w całości albo wcale', async () => {
  const original = Array.from({ length: 59 }, (_, id) => ({ id, text: 'Starszy ' + id }));
  const batch = { id: 'two', items: [{ text: 'pierwszy' }, { text: 'drugi' }] };
  const inbox = await openInbox({ items: original, batches: [batch] });
  assert.deepEqual(inbox.items(), original);
  assert.equal(inbox.pending.length, 1);
});

test('odbiera kilka paczek kolejno i zachowuje kolejność zdjęć wewnątrz paczki', async () => {
  const second = { id: 'two', items: [{ text: 'A' }, { text: 'B' }] };
  const inbox = await openInbox({ batches: [sample, second] });
  assert.deepEqual(inbox.items().map((item) => item.text), ['A', 'B', 'Z galerii']);
  assert.equal(inbox.pending.length, 0);
});
