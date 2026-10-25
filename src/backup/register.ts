import { registerImportOption } from '../features/onboarding/registry';

/** Onboarding offers the phone transfer as soon as the transfer exists. */
registerImportOption({ id: 'phone', titleKey: 'onb.import.phone', descriptionKey: 'onb.import.phoneHint', title: 'Dari HP', description: 'Pindahkan koleksi Musicfy dari HP ke TV.', route: { name: 'import', page: 'phone' } });
