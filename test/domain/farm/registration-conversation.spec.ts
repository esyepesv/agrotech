import { describe, expect, it } from 'vitest';
import {
  applyAnswer,
  nextStep,
  optionsForStep,
  promptFor,
  summaryOf,
  type RegistrationPartial,
} from '../../../src/domain/farm/registration-conversation.js';

// Finca completa del dueño salvo persona (idType/idNumber/email): así
// `nextStep` cae directo en la parte de la máquina que este test cubre.
const ownerPartialConFincaCompleta: RegistrationPartial = {
  role: 'administrador_dueno',
  phone: '+573001234567',
  farmName: 'La Esperanza',
  legalType: 'natural',
  taxId: '123456',
  location: 'Marinilla, Antioquia',
  cebaCapacity: 100,
  breedingCapacity: 10,
  totalCapacity: 110,
  sanitaryRegistry: 'ICA-0001',
};

describe('registration-conversation — correo obligatorio (tarea 3)', () => {
  it('nombra explícitamente al dueño o administrador en la opción de rol', () => {
    expect(optionsForStep('role', {})).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: 'Soy dueño o administrador' })]),
    );
  });

  it('ofrece todos los documentos colombianos y de extranjería admitidos', () => {
    expect(optionsForStep('idType', {})).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'reg:idType:TI' }),
        expect.objectContaining({ id: 'reg:idType:CC' }),
        expect.objectContaining({ id: 'reg:idType:CE' }),
        expect.objectContaining({ id: 'reg:idType:PPT' }),
        expect.objectContaining({ id: 'reg:idType:PEP' }),
        expect.objectContaining({ id: 'reg:idType:PA' }),
      ]),
    );
  });

  it('usa lista para que los seis documentos se puedan mostrar en todos los canales', () => {
    expect(promptFor('idType', {}, { channel: 'whatsapp' }).layout).toBe('list');
  });

  it('pide el correo al dueño y no ofrece saltarlo', () => {
    const partial: RegistrationPartial = {
      ...ownerPartialConFincaCompleta,
      idType: 'CC',
      idNumber: '123',
    };
    expect(nextStep(partial)).toBe('email');
    expect(optionsForStep('email', partial)).toBeUndefined();
  });

  it('también le pide el correo al trabajador', () => {
    const partial: RegistrationPartial = {
      role: 'trabajador',
      phone: '+573001234567',
      idType: 'CC',
      idNumber: '123',
      selectedFarmId: 'f1',
    };
    expect(nextStep(partial)).toBe('email');
  });

  it('vuelve a pedir el correo si no tiene forma de correo', () => {
    const result = applyAnswer({ role: 'administrador_dueno' }, 'email', 'juan arroba finca');
    expect(result.ok).toBe(false);
  });

  it('acepta un correo válido y lo normaliza a minúsculas sin espacios', () => {
    const result = applyAnswer({ role: 'administrador_dueno' }, 'email', '  Juan@Finca.CO ');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.email).toBe('juan@finca.co');
    }
  });

  it('avanza a confirm una vez que el dueño ya tiene correo', () => {
    const partial: RegistrationPartial = {
      ...ownerPartialConFincaCompleta,
      idType: 'CC',
      idNumber: '123',
      email: 'juan@finca.co',
    };
    expect(nextStep(partial)).toBe('confirm');
  });

  it('el resumen de confirmación siempre muestra el correo', () => {
    const partial: RegistrationPartial = {
      ...ownerPartialConFincaCompleta,
      idType: 'CC',
      idNumber: '123',
      email: 'juan@finca.co',
    };
    expect(summaryOf(partial)).toContain('juan@finca.co');
  });
});
