import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { parseList, matches, isAllowed } from './allowlist.js'

/* The source-IP allowlist is the layer deploy.md §9.1 calls "the one that
   makes the device key's visibility in the bundle tolerable". A bug here is
   either a branch locked out of the service or the internet let into it, so
   each case below is written as the outcome it must produce. */

describe('CIDR matching', () => {
  test('matches inside an IPv4 range and not outside it', () => {
    assert.ok(matches('203.0.113.5', '203.0.113.0/24'))
    assert.ok(matches('203.0.113.0', '203.0.113.0/24'))
    assert.ok(matches('203.0.113.255', '203.0.113.0/24'))
    assert.equal(matches('203.0.114.1', '203.0.113.0/24'), false)
    assert.equal(matches('203.0.112.255', '203.0.113.0/24'), false)
  })

  test('a bare address matches only itself', () => {
    assert.ok(matches('203.0.113.5', '203.0.113.5'))
    assert.equal(matches('203.0.113.6', '203.0.113.5'), false)
  })

  test('normalises IPv4-mapped IPv6, so plain v4 rules still apply', () => {
    assert.ok(matches('::ffff:203.0.113.5', '203.0.113.0/24'))
  })

  test('matches IPv6 ranges', () => {
    assert.ok(matches('2001:db8::1', '2001:db8::/32'))
    assert.ok(matches('2001:db8:0:0:0:0:0:1', '2001:db8::/32'))
    assert.equal(matches('2001:db9::1', '2001:db8::/32'), false)
  })

  test('never matches across address families', () => {
    assert.equal(matches('1.2.3.4', '2001:db8::/32'), false)
    assert.equal(matches('2001:db8::1', '0.0.0.0/0'), false)
  })

  /* Every one of these is a value that must not be read as "allow". A parser
     that threw, or that fell through to true, would be a bypass. */
  test('rejects malformed addresses and prefixes rather than matching them', () => {
    for (const [address, entry] of [
      ['999.1.1.1', '999.1.1.1'],
      ['1.2.3', '1.2.3.0/24'],
      ['1.2.3.4.5', '1.2.3.0/24'],
      ['not-an-ip', '203.0.113.0/24'],
      ['', '203.0.113.0/24'],
      [null, '203.0.113.0/24'],
      [undefined, '203.0.113.0/24'],
      ['203.0.113.5', '203.0.113.0/33'],
      ['203.0.113.5', '203.0.113.0/-1'],
      ['203.0.113.5', '203.0.113.0/abc'],
      ['203.0.113.5', ''],
      ['2001:db8::1', '2001:db8::/129'],
      ['2001:db8::1::2', '2001:db8::/32'],
      ['2001:dbg::1', '2001:db8::/32'],
    ]) {
      assert.equal(matches(address, entry), false, `should reject ${JSON.stringify(address)} vs ${JSON.stringify(entry)}`)
    }
  })

  test('/0 matches everything in its own family — an explicit choice, not a default', () => {
    assert.ok(matches('203.0.113.5', '0.0.0.0/0'))
    assert.ok(matches('2001:db8::1', '::/0'))
  })
})

describe('allowlist evaluation', () => {
  test('parses a comma-separated list and ignores blanks', () => {
    assert.deepEqual(parseList(' 10.0.0.0/8 , 192.168.0.0/16 ,, '), ['10.0.0.0/8', '192.168.0.0/16'])
    assert.deepEqual(parseList(''), [])
    assert.deepEqual(parseList(undefined), [])
  })

  test('allows an address present in any entry', () => {
    const entries = parseList('10.0.0.0/8, 192.168.0.0/16')
    assert.ok(isAllowed('10.1.2.3', entries))
    assert.ok(isAllowed('192.168.7.9', entries))
    assert.equal(isAllowed('172.16.0.1', entries), false)
  })

  /* The property that matters most: a deployment that forgot to configure the
     allowlist must deny, exactly as auth.js denies on unset API keys. */
  test('fails closed on an empty list', () => {
    assert.equal(isAllowed('203.0.113.5', []), false)
    assert.equal(isAllowed('203.0.113.5', parseList('')), false)
  })

  test('fails closed when the request carries no client address', () => {
    const entries = parseList('0.0.0.0/0')
    assert.equal(isAllowed('', entries), false)
    assert.equal(isAllowed(undefined, entries), false)
  })
})
