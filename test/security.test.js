import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedHost, isAllowedOrigin, parseRequestUrl } from '../src/security.js';

test('solo se aceptan peticiones dirigidas a la propia app (protección contra DNS rebinding)', () => {
  for (const host of ['127.0.0.1:4317', 'localhost:4317', 'LOCALHOST:4317', '[::1]:4317']) {
    assert.equal(isAllowedHost(host, 4317), true, host);
  }
  for (const host of ['evil.example:4317', 'localhost', 'localhost:80', '127.0.0.1:4318', 'localhost.evil.example:4317', '', undefined]) {
    assert.equal(isAllowedHost(host, 4317), false, String(host));
  }
});

test('las acciones solo se aceptan desde la propia app o sin Origin (herramientas locales)', () => {
  assert.equal(isAllowedOrigin('http://localhost:4317', 4317), true);
  assert.equal(isAllowedOrigin('http://127.0.0.1:4317', 4317), true);
  assert.equal(isAllowedOrigin(undefined, 4317), true);
  assert.equal(isAllowedOrigin('https://evil.example', 4317), false);
  assert.equal(isAllowedOrigin('http://localhost:4317.evil.example', 4317), false);
  assert.equal(isAllowedOrigin('null', 4317), false);
});

test('una URL malformada no lanza errores', () => {
  assert.equal(parseRequestUrl('/api/chats?x=1', 4317).pathname, '/api/chats');
  assert.equal(parseRequestUrl(undefined, 4317).pathname, '/');
  assert.equal(parseRequestUrl('http://[malformada', 4317), null);
});
