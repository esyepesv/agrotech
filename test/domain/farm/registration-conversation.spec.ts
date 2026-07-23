import { describe, expect, it } from 'vitest';
import {
  applyAnswer,
  clearStepField,
  correctableSteps,
  nextStep,
  optionsForStep,
  parseGlobalCommand,
  previousStep,
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

describe('registration-conversation — corregir, atrás y cancelar', () => {
  const completo: RegistrationPartial = {
    ...ownerPartialConFincaCompleta,
    idType: 'CC',
    idNumber: '123',
    email: 'juan@finca.co',
  };

  it('reconoce "atrás" y "cancelar" escritos de cualquier forma', () => {
    expect(parseGlobalCommand('atrás')).toBe('back');
    expect(parseGlobalCommand('ATRAS')).toBe('back');
    expect(parseGlobalCommand(' volver ')).toBe('back');
    expect(parseGlobalCommand('cancelar')).toBe('cancel');
    expect(parseGlobalCommand('La Esperanza')).toBeUndefined();
    // Un número es una respuesta válida de capacidad, nunca un comando.
    expect(parseGlobalCommand('250')).toBeUndefined();
  });

  it('corregir un solo campo conserva todos los demás', () => {
    const result = applyAnswer(completo, 'correctPick', 'reg:correctPick:farmName');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.farmName).toBeUndefined();
    // Lo demás sigue intacto…
    expect(result.value.taxId).toBe('123456');
    expect(result.value.email).toBe('juan@finca.co');
    expect(result.value.totalCapacity).toBe(110);
    // …y la máquina vuelve justo a la pregunta borrada.
    expect(nextStep(result.value)).toBe('farmName');
  });

  it('tras corregir un campo y responderlo, se vuelve directo al resumen', () => {
    const corrigiendo = clearStepField(completo, 'farmName');
    const respondido = applyAnswer(corrigiendo, 'farmName', 'Villa Clara');

    expect(respondido.ok).toBe(true);
    if (!respondido.ok) return;
    expect(nextStep(respondido.value)).toBe('confirm');
    expect(respondido.value.farmName).toBe('Villa Clara');
  });

  it('atrás retrocede una sola pregunta según el orden del rol', () => {
    expect(previousStep('location', completo)).toBe('taxId');
    expect(previousStep('confirm', completo)).toBe('email');
    // Desde la primera pregunta no hay a dónde volver.
    expect(previousStep('role', completo)).toBeUndefined();
  });

  it('el trabajador tiene su propio orden de pasos', () => {
    const trabajador: RegistrationPartial = {
      role: 'trabajador',
      phone: '+573001234567',
      idType: 'CC',
      idNumber: '123',
      email: 'ana@finca.co',
    };
    expect(previousStep('workerFarmSearch', trabajador)).toBe('email');
    expect(previousStep('idType', trabajador)).toBe('phone');
  });

  it('solo ofrece corregir datos ya respondidos', () => {
    const aMedias: RegistrationPartial = {
      role: 'administrador_dueno',
      phone: '+573001234567',
      farmName: 'La Esperanza',
    };
    const labels = correctableSteps(aMedias);
    expect(labels).toContain('farmName');
    expect(labels).not.toContain('email');
    expect(labels).not.toContain('taxId');
  });

  it('no ofrece corregir un celular que probó el canal', () => {
    expect(correctableSteps({ ...completo, phoneVerified: true })).not.toContain('phone');
    expect(correctableSteps({ ...completo, phoneVerified: false })).toContain('phone');
  });
});
