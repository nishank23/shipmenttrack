export function getShipmentNotificationKind(shipment, user, alertDays) {
  if (shipment.archived) return null
  if (user.etaUpdates !== false && shipment.etaChanged) return 'eta-update'
  if (user.arrivalReminders !== false && shipment.daysRemaining != null &&
      shipment.daysRemaining >= 0 && shipment.daysRemaining <= alertDays) return 'arrival-reminder'
  return null
}
