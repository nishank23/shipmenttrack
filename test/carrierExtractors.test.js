import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  extractEvergreenContainerMoves,
  extractEvergreenMoveRequests,
  extractPilContainers,
  extractPilContainerTracking,
  extractTrackingPayload,
} from '../functions/lib/trackingExtractors.js'
import { resolvePort } from '../src/lib/portLocations.js'

const summary = (result) =>
  result.events.map((event) => [event.title, event.location, event.occurredAt?.toISOString().slice(0, 10)])

test('ONE milestone codes become named moves; deadlines are skipped', () => {
  const payload = {
    status: 200,
    data: [{
      containerNo: 'ABCU1234567',
      por: { code: 'INHZA', locationName: 'HAZIRA' },
      pod: { code: 'MZMPM', locationName: 'MAPUTO' },
      vesselVoyage: { vesselName: 'TEST VESSEL' },
      latestEvent: { eventName: 'Empty Container Returned from Customer', locationName: 'MAPUTO', date: '2026-08-18T09:00:00.000Z' },
      cargoEvents: [
        { matrixId: 'E061', locationName: 'HAZIRA', countryCode: 'IN', date: '2026-07-03T02:54:00.000Z', trigger: 'ACTUAL' },
        { matrixId: 'E089', locationName: 'MAPUTO', countryCode: 'MZ', date: '2026-08-11T17:32:00.000Z', trigger: 'ACTUAL' },
        { matrixId: 'E105', locationName: 'MAPUTO', countryCode: 'MZ', date: '2026-08-20T00:00:00.000Z', trigger: 'ACTUAL' },
      ],
    }],
  }
  const result = extractTrackingPayload({ carrier: 'ONE', payload, blNo: 'TEST' })
  assert.deepEqual(summary(result), [
    ['Vessel departure from port of loading', 'HAZIRA, IN', '2026-07-03'],
    ['Vessel arrival at POD', 'MAPUTO, MZ', '2026-08-11'],
    ['Empty Container Returned from Customer', 'MAPUTO, MZ', '2026-08-18'],
  ])
  assert.equal(result.eta.toISOString().slice(0, 10), '2026-08-11')
  assert.equal(resolvePort('HAZIRA, IN')?.name, 'Hazira')
})

test('Evergreen: move requests from the B/L page, moves per container', () => {
  const blPage = `<table><tr><td>
    <form name="frmCntrMove" action="/x" method="post">
      <input type="hidden" name="bl_no" value="000000000001">
      <input type="hidden" name="cntr_no">
      <input type="hidden" name="pol" value="INHAZ">
      <input type="hidden" name="TYPE" value="CntrMove">
    </form></td></tr>
    <tr><td>Port of Discharge</td><td>MAPUTO (MZ)</td></tr>
    <tr><td>ABCU1234567</td><td>40'(SH)</td><td>SEAL</td><td>FCL/FCL</td><td>10 BOXES</td><td>1</td><td>1 KGS</td><td>Empty container returned</td><td>SEP-11-2026</td></tr>
  </table>`
  assert.deepEqual(extractEvergreenMoveRequests(blPage), {
    fields: { bl_no: '000000000001', pol: 'INHAZ', TYPE: 'CntrMove' },
    containers: ['ABCU1234567'],
  })
  assert.deepEqual(summary(extractTrackingPayload({ carrier: 'EVERGREEN', payload: blPage, blNo: 'TEST' })), [
    ['Empty container returned', 'MAPUTO, MZ', '2026-09-11'],
  ])

  const moves = `<table>
    <tr><td>Date</td><td>Container Moves</td><td>Location</td><td>Vessel Voyage</td></tr>
    <tr><td>JUL-15-2026</td><td>Loaded (FCL) on vessel</td><td>HAZIRA (IN)</td><td>VESSEL A 001E</td></tr>
    <tr><td>JUL-18-2026</td><td>Discharged and waiting for transshipping</td><td>MUNDRA (IN)</td><td>VESSEL A 001W</td></tr>
    <tr><td>SEP-04-2026</td><td>Discharged (FCL)</td><td>MAPUTO (MZ)</td><td>VESSEL B 120W</td></tr>
  </table>`
  assert.deepEqual(summary(extractEvergreenContainerMoves(moves, 'TEST', 'ABCU1234567')), [
    ['Loaded (FCL) on vessel', 'HAZIRA, IN', '2026-07-15'],
    ['Discharged and waiting for transshipping', 'MUNDRA, IN', '2026-07-18'],
    ['Discharged (FCL)', 'MAPUTO, MZ', '2026-09-04'],
  ])
})

test('PIL: containers from the B/L table and trace rows without a table', () => {
  const blPayload = {
    success: true,
    data: '<table><tbody><tr><td><b class="cont-numb">ABCU1234567</b></td><td>20GP</td></tr></tbody></table>',
  }
  assert.deepEqual(extractPilContainers(blPayload), ['ABCU1234567'])

  const cell = (text) => `<td class="mypil-tbody-no-top-border">${text}</td>`
  const row = (bold, ...cells) => `<tr class="bg-lightblue text-fc-black${bold ? ' text-fw-bold' : ''}">${cell('')}${cells.map(cell).join('')}</tr>`
  const trace = {
    success: true,
    data: [
      row(true, 'Vessel', 'Voyage', 'Event Date', 'Event Name', 'Event Location'),
      row(false, 'VESSEL A', 'V1', '20-Mar-2026 15:16:00', 'Vessel Loading', 'SURABAYA'),
      row(false, 'VESSEL B', 'V2', '09-May-2026 21:18:00', 'Vessel Discharge', 'MAPUTO'),
    ].join(''),
  }
  const result = extractPilContainerTracking(trace, 'TEST', 'ABCU1234567')
  assert.deepEqual(result.events.map((event) => [event.title, event.location, event.description]), [
    ['Vessel Loading', 'SURABAYA', 'VESSEL A · V1'],
    ['Vessel Discharge', 'MAPUTO', 'VESSEL B · V2'],
  ])
  assert.ok(result.eta)
})
