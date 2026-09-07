import { getSettings, readinessFromSettings } from './_lib/settings.js';

export default async function handler(req, res) {
  const settings = await getSettings();
  return res.status(200).json(readinessFromSettings(settings));
}
