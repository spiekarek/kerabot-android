'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const app = readFileSync(join(__dirname, '../www/app.js'), 'utf8');
const key = 'kerabot_offline_outbox_v1';

function openInbox({ items = [], batches = [], blockWrites = false, blockAck = false } = {}) {
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
      peek: () => pending.length ? JSON.stringify(pending[0]) : '',
      acknowledge(id) {
        if (failures.ack || pending[0]?.id !== id) return false;
        pending.shift();
        return true;
      },
    },
  };
  vm.runInNewContext(app, {
    document, window, localStorage,
    navigator: { onLine: true },
    fetch: async () => { throw new Error('offline'); },
    setTimeout() {},
  });
  return {
    items: () => JSON.parse(data.get(key)),
    status: () => statuses.get('outbox-status') ?? '',
    pending,
    failures,
    retry: () => window.SebaConsumePendingShare(),
  };
}

const sample = { id: 'one', items: [{ text: 'Z galerii', photo: 'data:image/jpeg;base64,AA==' }] };

test('błąd zapisu zachowuje całą kolejkę i paczkę oraz pozwala zapisać później', () => {
  const original = [{ id: 7, text: 'starszy wpis' }];
  const inbox = openInbox({ items: original, batches: [sample], blockWrites: true });
  assert.deepEqual(inbox.items(), original);
  assert.equal(inbox.pending.length, 1);
  assert.match(inbox.status(), /Paczka czeka/);
  inbox.failures.write = false;
  assert.equal(inbox.retry(), 1);
  assert.equal(inbox.pending.length, 0);
  assert.equal(inbox.items()[0].photo, sample.items[0].photo);
  assert.equal(inbox.items()[1].id, 7);
});

test('ponowienie po nieudanym potwierdzeniu nie dubluje wpisu', () => {
  const inbox = openInbox({ batches: [sample], blockAck: true });
  assert.equal(inbox.items().length, 1);
  assert.equal(inbox.pending.length, 1);
  inbox.failures.ack = false;
  assert.equal(inbox.retry(), 0);
  assert.equal(inbox.items().length, 1);
  assert.equal(inbox.pending.length, 0);
});

test('pełny Inbox pozostawia wszystkie wpisy i zmieści paczkę w całości albo wcale', () => {
  const original = Array.from({ length: 59 }, (_, id) => ({ id, text: 'Starszy ' + id }));
  const batch = { id: 'two', items: [{ text: 'pierwszy' }, { text: 'drugi' }] };
  const inbox = openInbox({ items: original, batches: [batch] });
  assert.deepEqual(inbox.items(), original);
  assert.equal(inbox.pending.length, 1);
});

test('odbiera kilka paczek kolejno i zachowuje kolejność zdjęć wewnątrz paczki', () => {
  const second = { id: 'two', items: [{ text: 'A' }, { text: 'B' }] };
  const inbox = openInbox({ batches: [sample, second] });
  assert.deepEqual(inbox.items().map((item) => item.text), ['A', 'B', 'Z galerii']);
  assert.equal(inbox.pending.length, 0);
});
