import { isActualRunwayEvent } from './arrivalRunway.js'

export function toTrackingDate(value) {
  if (!value) return null
  const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

const byNewest = (a, b) => (b.occurredAt?.getTime() ?? -Infinity) - (a.occurredAt?.getTime() ?? -Infinity)
const fingerprint = (event) => JSON.stringify([event.container, event.title, event.location, event.occurredAt])

function normalizeEvent(raw, index, now) {
  if (!raw) return null
  const event = typeof raw === 'string' ? { title: raw } : raw
  const title = String(event.title ?? event.status ?? event.event ?? event.name ?? event.label ?? 'Status updated').trim()
  if (!title) return null
  const occurredAt = toTrackingDate(event.occurredAt ?? event.timestamp ?? event.date ?? event.updatedAt ?? event.createdAt ?? event.at)
  const container = String(event.container ?? '').trim().toUpperCase()
  const estimated = !isActualRunwayEvent({ title, estimated: event.estimated, occurredAt }, now)
    || Boolean(occurredAt && occurredAt.getTime() > now)
  return {
    id: `${container}:${event.id ?? index}:${index}`,
    title, occurredAt, estimated, container,
    description: String(event.description ?? event.message ?? event.details ?? '').trim(),
    location: String(event.location ?? event.port ?? event.place ?? '').trim(),
  }
}

export function getCheckpointHistory(cache, latestEvent, now) {
  const raw = [cache?.events, cache?.statusEvents, cache?.timeline, cache?.history].find(Array.isArray) ?? []
  const events = raw.map((event, index) => normalizeEvent(event, index, now)).filter(Boolean)
  const lastKnown = normalizeEvent(latestEvent, 'shipment', now)
  if (lastKnown && !lastKnown.estimated && !events.some((event) => !event.estimated && fingerprint(event) === fingerprint(lastKnown))) {
    events.push(lastKnown)
  }
  return {
    reported: events.filter((event) => !event.estimated).sort(byNewest),
    planned: events.filter((event) => event.estimated).sort((a, b) => (a.occurredAt?.getTime() ?? Infinity) - (b.occurredAt?.getTime() ?? Infinity)),
  }
}

export function getPlannedCheckpointGroups(events, selectedContainer = '') {
  const groups = []
  const byPlan = new Map()
  for (const event of events) {
    if (selectedContainer && event.container !== selectedContainer) continue

    // Without a date or a container, we can't tell whether the records describe a shared plan.
    const key = event.occurredAt && event.container
      ? JSON.stringify([event.title, event.occurredAt.getTime(), event.location, event.description])
      : null
    let group = byPlan.get(key)
    if (!group) {
      group = { ...event, containers: [] }
      groups.push(group)
      if (key !== null) byPlan.set(key, group)
    }
    if (event.container && !group.containers.includes(event.container)) group.containers.push(event.container)
  }
  return groups
}

export function getRouteCheckpoints(reported) {
  const locations = reported.filter((event) => event.occurredAt && event.location)
  const last = locations[0] ?? null
  const first = locations.at(-1) ?? null
  return { first: first === last ? null : first, last }
}
