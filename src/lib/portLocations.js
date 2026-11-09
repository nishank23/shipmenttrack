/**
 * Approximate coordinates for container ports that carriers name in their
 * events. Carriers write locations as "MAPUTO, MZ", "SINGAPORE CMA CGM PSA
 * LION TERMINAL" or a UN/LOCODE such as "MZMPM", so each port is matched by
 * name, alias or LOCODE. Coordinates are the port area, good for a globe,
 * not for navigation.
 */
const PORTS = [
  // Asia
  ['Shanghai', 'CN', 'CNSHA', 31.23, 121.8],
  ['Ningbo', 'CN', 'CNNGB', 29.93, 121.85, ['NINGBO-ZHOUSHAN', 'BEILUN']],
  ['Shenzhen', 'CN', 'CNSZX', 22.5, 113.9, ['YANTIAN', 'SHEKOU', 'CHIWAN']],
  ['Guangzhou', 'CN', 'CNCAN', 22.75, 113.6, ['NANSHA']],
  ['Qingdao', 'CN', 'CNTAO', 36.0, 120.3],
  ['Tianjin', 'CN', 'CNTSN', 38.98, 117.75, ['XINGANG']],
  ['Xiamen', 'CN', 'CNXMN', 24.45, 118.07],
  ['Dalian', 'CN', 'CNDLC', 38.93, 121.65],
  ['Hong Kong', 'HK', 'HKHKG', 22.3, 114.15],
  ['Kaohsiung', 'TW', 'TWKHH', 22.6, 120.28],
  ['Busan', 'KR', 'KRPUS', 35.1, 129.04, ['PUSAN']],
  ['Tokyo', 'JP', 'JPTYO', 35.62, 139.78],
  ['Yokohama', 'JP', 'JPYOK', 35.45, 139.65],
  ['Kobe', 'JP', 'JPUKB', 34.67, 135.2],
  ['Singapore', 'SG', 'SGSIN', 1.26, 103.84],
  ['Port Klang', 'MY', 'MYPKG', 3.0, 101.39, ['KLANG']],
  ['Tanjung Pelepas', 'MY', 'MYTPP', 1.36, 103.55],
  ['Penang', 'MY', 'MYPEN', 5.41, 100.35],
  ['Laem Chabang', 'TH', 'THLCH', 13.08, 100.88],
  ['Bangkok', 'TH', 'THBKK', 13.7, 100.57],
  ['Ho Chi Minh City', 'VN', 'VNSGN', 10.77, 106.75, ['HO CHI MINH', 'CAT LAI', 'SAIGON']],
  ['Cai Mep', 'VN', 'VNCMP', 10.53, 107.03],
  ['Haiphong', 'VN', 'VNHPH', 20.85, 106.75, ['HAI PHONG']],
  ['Manila', 'PH', 'PHMNL', 14.6, 120.95],
  ['Jakarta', 'ID', 'IDJKT', -6.1, 106.88, ['TANJUNG PRIOK']],
  ['Surabaya', 'ID', 'IDSUB', -7.2, 112.73, ['TANJUNG PERAK', 'SBY']],
  ['Semarang', 'ID', 'IDSRG', -6.95, 110.42],
  ['Belawan', 'ID', 'IDBLW', 3.78, 98.68],
  ['Colombo', 'LK', 'LKCMB', 6.95, 79.85],
  ['Nhava Sheva', 'IN', 'INNSA', 18.95, 72.95, ['JAWAHARLAL NEHRU', 'JNPT', 'MUMBAI']],
  ['Mundra', 'IN', 'INMUN', 22.74, 69.7],
  ['Hazira', 'IN', 'INHZA', 21.08, 72.63, ['INHAZ']],
  ['Pipavav', 'IN', 'INPAV', 20.9, 71.5],
  ['Kandla', 'IN', 'INIXY', 23.0, 70.22, ['DEENDAYAL']],
  ['Chennai', 'IN', 'INMAA', 13.1, 80.3],
  ['Chittagong', 'BD', 'BDCGP', 22.3, 91.8],
  ['Karachi', 'PK', 'PKKHI', 24.83, 66.98],
  // Middle East
  ['Jebel Ali', 'AE', 'AEJEA', 25.01, 55.06, ['DUBAI']],
  ['Abu Dhabi', 'AE', 'AEAUH', 24.52, 54.38, ['KHALIFA']],
  ['Salalah', 'OM', 'OMSLL', 16.95, 54.0],
  ['Jeddah', 'SA', 'SAJED', 21.48, 39.17],
  ['Dammam', 'SA', 'SADMM', 26.5, 50.2],
  ['Hamad', 'QA', 'QAHMD', 24.98, 51.6],
  ['Port Said', 'EG', 'EGPSD', 31.26, 32.3],
  // Africa
  ['Maputo', 'MZ', 'MZMPM', -25.97, 32.57],
  ['Beira', 'MZ', 'MZBEW', -19.83, 34.84],
  ['Nacala', 'MZ', 'MZMNC', -14.54, 40.67],
  ['Durban', 'ZA', 'ZADUR', -29.87, 31.03],
  ['Coega', 'ZA', 'ZAZBA', -33.79, 25.68, ['NGQURA', 'PORT OF NGQURA']],
  ['Port Elizabeth', 'ZA', 'ZAPLZ', -33.96, 25.63, ['GQEBERHA']],
  ['Cape Town', 'ZA', 'ZACPT', -33.91, 18.43],
  ['Walvis Bay', 'NA', 'NAWVB', -22.95, 14.5],
  ['Dar es Salaam', 'TZ', 'TZDAR', -6.83, 39.29],
  ['Mombasa', 'KE', 'KEMBA', -4.06, 39.66],
  ['Djibouti', 'DJ', 'DJJIB', 11.6, 43.13],
  ['Port Louis', 'MU', 'MUPLU', -20.15, 57.49],
  ['Toamasina', 'MG', 'MGTMM', -18.15, 49.42, ['TAMATAVE']],
  ['Lome', 'TG', 'TGLFW', 6.13, 1.28],
  ['Tema', 'GH', 'GHTEM', 5.63, 0.0],
  ['Lagos', 'NG', 'NGLOS', 6.43, 3.4, ['APAPA', 'TIN CAN']],
  ['Abidjan', 'CI', 'CIABJ', 5.28, -4.0],
  ['Dakar', 'SN', 'SNDKR', 14.68, -17.43],
  ['Tanger Med', 'MA', 'MAPTM', 35.88, -5.5, ['TANGIER']],
  ['Luanda', 'AO', 'AOLAD', -8.8, 13.23],
  // Europe
  ['Rotterdam', 'NL', 'NLRTM', 51.95, 4.05],
  ['Antwerp', 'BE', 'BEANR', 51.27, 4.33],
  ['Hamburg', 'DE', 'DEHAM', 53.53, 9.97],
  ['Bremerhaven', 'DE', 'DEBRV', 53.57, 8.55],
  ['Le Havre', 'FR', 'FRLEH', 49.48, 0.12],
  ['Felixstowe', 'GB', 'GBFXT', 51.95, 1.33],
  ['Southampton', 'GB', 'GBSOU', 50.9, -1.43],
  ['Algeciras', 'ES', 'ESALG', 36.13, -5.44],
  ['Valencia', 'ES', 'ESVLC', 39.44, -0.32],
  ['Barcelona', 'ES', 'ESBCN', 41.35, 2.17],
  ['Genoa', 'IT', 'ITGOA', 44.4, 8.92, ['GENOVA']],
  ['Gioia Tauro', 'IT', 'ITGIT', 38.45, 15.9],
  ['Piraeus', 'GR', 'GRPIR', 37.94, 23.63],
  ['Gdansk', 'PL', 'PLGDN', 54.4, 18.67],
  // Americas
  ['New York', 'US', 'USNYC', 40.67, -74.04, ['NEWARK', 'ELIZABETH']],
  ['Savannah', 'US', 'USSAV', 32.08, -81.09],
  ['Houston', 'US', 'USHOU', 29.73, -95.27],
  ['Los Angeles', 'US', 'USLAX', 33.74, -118.26],
  ['Long Beach', 'US', 'USLGB', 33.75, -118.2],
  ['Oakland', 'US', 'USOAK', 37.8, -122.32],
  ['Seattle', 'US', 'USSEA', 47.58, -122.35],
  ['Vancouver', 'CA', 'CAVAN', 49.29, -123.1],
  ['Manzanillo', 'MX', 'MXZLO', 19.06, -104.3],
  ['Balboa', 'PA', 'PABLB', 8.95, -79.57],
  ['Colon', 'PA', 'PAONX', 9.36, -79.88, ['MANZANILLO PA', 'CRISTOBAL']],
  ['Cartagena', 'CO', 'COCTG', 10.4, -75.53],
  ['Callao', 'PE', 'PECLL', -12.05, -77.15],
  ['San Antonio', 'CL', 'CLSAI', -33.59, -71.62],
  ['Santos', 'BR', 'BRSSZ', -23.98, -46.3],
  ['Buenos Aires', 'AR', 'ARBUE', -34.6, -58.37],
  // Oceania
  ['Sydney', 'AU', 'AUSYD', -33.97, 151.21, ['BOTANY']],
  ['Melbourne', 'AU', 'AUMEL', -37.84, 144.92],
  ['Brisbane', 'AU', 'AUBNE', -27.38, 153.17],
  ['Auckland', 'NZ', 'NZAKL', -36.84, 174.77],
]

const byLocode = new Map()
const byName = []
for (const [name, country, locode, lat, lon, aliases = []] of PORTS) {
  const port = { name, country, locode, lat, lon }
  byLocode.set(locode, port)
  for (const key of [name, ...aliases]) {
    byName.push([new RegExp(`(^|[^A-Z])${key.toUpperCase()}([^A-Z]|$)`), key.length, port])
  }
}
// Longest names first, so "PORT ELIZABETH" wins over a shorter partial match.
byName.sort((a, b) => b[1] - a[1])

/**
 * Resolves a carrier location string to a known port, or null.
 *   "MAPUTO, MZ"                          -> Maputo
 *   "SINGAPORE CMA CGM PSA LION TERMINAL" -> Singapore
 *   "MZMPM 03-May-2026"                   -> Maputo (by LOCODE)
 */
export function resolvePort(location) {
  const text = String(location ?? '').toUpperCase().replace(/\s+/g, ' ').trim()
  if (!text) return null

  for (const token of text.match(/\b[A-Z]{5}\b/g) ?? []) {
    const port = byLocode.get(token)
    if (port) return port
  }

  const place = text.split(',')[0].trim()
  const country = text.match(/,\s*([A-Z]{2})\b/)?.[1]
  for (const [pattern, , port] of byName) {
    if (country && country !== port.country) continue
    if (pattern.test(place)) return port
  }
  return null
}
