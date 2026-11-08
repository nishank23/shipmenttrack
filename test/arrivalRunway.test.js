import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getRunwayEta, getRunwayMilestone, hasTimedEta, runwayMilestones } from '../src/lib/arrivalRunway.js'

const HOUR = 3600000
const now = new Date(2026, 3, 15, 9, 30).getTime()

test('positions recognized carrier events at the matching milestone', () => {
  const events = ['Origin gate in', 'Loaded on vessel', 'Out-for-delivery', 'Arrival at final destination']
  assert.deepEqual(events.map((title) => getRunwayMilestone({ title }, now)), runwayMilestones)
  assert.equal(getRunwayMilestone({ title: 'E105' }, now)?.id, 'arriving')
  assert.equal(getRunwayMilestone({ title: 'Discharged for transshipment' }, now)?.id, 'in-transit')
})

test('does not infer progress from forecasts or ambiguous port events', () => {
  const events = ['Expected out for delivery', 'Estimated time of arrival at destination', 'Gate in', 'Vessel discharge', 'Empty returned']
  for (const title of events) assert.equal(getRunwayMilestone({ title }, now), null, title)
  assert.equal(getRunwayMilestone(null, now), null)
  assert.equal(getRunwayMilestone({ title: 'Dispatched', estimated: true }, now), null)
  assert.equal(getRunwayMilestone({ title: 'Dispatched', occurredAt: new Date(now + HOUR) }, now), null)
})

test('timed ETA becomes urgent exactly 24 hours ahead and stops after it passes', () => {
  assert.equal(getRunwayEta(new Date(now + 24 * HOUR + 1), now, true).dueSoon, false)
  assert.equal(getRunwayEta(new Date(now + 24 * HOUR), now, true).dueSoon, true)
  assert.equal(getRunwayEta(new Date(now + 2 * HOUR), now, true).label, 'Due in 2h')
  const overdue = getRunwayEta(new Date(now - 1), now, true)
  assert.equal(overdue.overdue, true)
  assert.equal(overdue.dueSoon, false)
  assert.equal(getRunwayEta(null, now, true).label, 'No ETA reported')
})

test('date-only ETAs do not imply a particular arrival hour', () => {
  const today = new Date(2026, 3, 15, 12)
  const tomorrow = new Date(2026, 3, 16, 12)
  assert.equal(hasTimedEta(today, 'firestore'), false)
  assert.equal(hasTimedEta(today, 'carrier'), false)
  assert.equal(hasTimedEta(new Date('2026-04-16T12:00:00Z'), 'carrier'), false)
  assert.equal(hasTimedEta(new Date(now), 'carrier'), true)
  assert.deepEqual(getRunwayEta(today, now + 10 * HOUR, false), {
    label: 'Due today', dueSoon: true, overdue: false,
  })
  assert.equal(getRunwayEta(tomorrow, now, false).dueSoon, false)
  assert.equal(getRunwayEta(tomorrow, now, false).label, 'Due tomorrow')
})
