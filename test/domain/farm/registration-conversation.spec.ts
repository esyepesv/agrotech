import { describe, expect, it } from 'vitest';
import {
  applyAnswer,
  clearStepField,
  correctableSteps,
  nextStep,
  normalizeSpokenEmail,
  normalizeSpokenNumber,
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

describe('registration-conversation — respuestas dictadas por voz', () => {
  const porVoz = { inputWasVoice: true };

  it('entiende cantidades dictadas con palabras alrededor o puntuación', () => {
    // Whisper casi siempre agrega el punto final; antes eso solo ya fallaba.
    for (const [frase, esperado] of [
      ['250', 250],
      ['50.', 50],
      ['son 250', 250],
      ['250 cerdos', 250],
      ['doscientos cincuenta', 250],
      ['doscientos cincuenta cerdos', 250],
      ['como unos cincuenta', 50],
    ] as const) {
      expect(normalizeSpokenNumber(frase), frase).toBe(esperado);
    }
  });

  it('no inventa una cantidad si no hay número, ni elige entre dos', () => {
    expect(normalizeSpokenNumber('no sé cuántos')).toBeUndefined();
    expect(normalizeSpokenNumber('')).toBeUndefined();
    expect(normalizeSpokenNumber('entre 20 y 30')).toBeUndefined();
  });

  it('convierte un correo dictado en su forma escrita', () => {
    expect(normalizeSpokenEmail('juan arroba gmail punto com')).toBe('juan@gmail.com');
    expect(normalizeSpokenEmail('Ana punto Ruiz arroba finca punto co')).toBe('ana.ruiz@finca.co');
    expect(normalizeSpokenEmail('juan guion bajo perez arroba mail punto com')).toBe(
      'juan_perez@mail.com',
    );
  });

  it('el correo dictado se lee de vuelta antes de guardarlo', () => {
    const result = applyAnswer(
      { role: 'administrador_dueno' },
      'email',
      'juan arroba finca punto co',
      porVoz,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Todavía NO se guarda: primero se confirma.
    expect(result.value.email).toBeUndefined();
    expect(result.value.pendingReadback).toEqual({ field: 'email', value: 'juan@finca.co' });
    expect(nextStep(result.value)).toBe('emailConfirm');

    const confirmado = applyAnswer(result.value, 'emailConfirm', 'reg:emailConfirm:yes');
    expect(confirmado.ok).toBe(true);
    if (!confirmado.ok) return;
    expect(confirmado.value.email).toBe('juan@finca.co');
    expect(confirmado.value.pendingReadback).toBeUndefined();
  });

  it('un correo dictado que no se entiende se vuelve a preguntar, no se guarda', () => {
    const result = applyAnswer({ role: 'administrador_dueno' }, 'email', 'no sé', porVoz);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.resetToStep).toBe('email');
  });

  it('escrito sigue funcionando igual: sin lectura de vuelta', () => {
    const result = applyAnswer({ role: 'administrador_dueno' }, 'email', '  Juan@Finca.CO ');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.email).toBe('juan@finca.co');
    expect(result.value.pendingReadback).toBeUndefined();
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
