import { describe, expect, it } from 'vitest';
import { isSelfSharedContact } from '../../../src/domain/otp/telegram-contact.js';

describe('isSelfSharedContact', () => {
  it('acepta el contacto cuando contact.user_id coincide con el remitente', () => {
    const contact = { phoneNumber: '+573001234567', contactUserId: 123456 };
    expect(isSelfSharedContact(contact, '123456')).toBe(true);
  });

  it('rechaza el contacto cuando contact.user_id NO coincide con el remitente (contacto reenviado de otra persona)', () => {
    const contact = { phoneNumber: '+573001234567', contactUserId: 999999 };
    expect(isSelfSharedContact(contact, '123456')).toBe(false);
  });

  it('compara como string aunque contactUserId venga numérico', () => {
    const contact = { phoneNumber: '+573001234567', contactUserId: 123456 };
    expect(isSelfSharedContact(contact, '123456')).toBe(true);
    expect(isSelfSharedContact({ ...contact, contactUserId: '123456' }, '123456')).toBe(true);
  });
});
