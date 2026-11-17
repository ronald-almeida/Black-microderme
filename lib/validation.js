export const AMOUNT = 29700;
export const PRODUCT = 'Método Microderme';
export function validCpf(value) {
  const cpf = String(value).replace(/\D/g, '');
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  for (let size = 9; size <= 10; size++) {
    let sum = 0;
    for (let i = 0; i < size; i++) sum += Number(cpf[i]) * (size + 1 - i);
    const digit = ((sum * 10) % 11) % 10;
    if (digit !== Number(cpf[size])) return false;
  }
  return true;
}
export function validateCustomer(input) {
  const source = input && typeof input === 'object' ? input : {};
  const customer = {
    name: typeof source.name === 'string' ? source.name.trim().replace(/\s+/g, ' ') : '',
    email: typeof source.email === 'string' ? source.email.trim().toLowerCase() : '',
    document: typeof source.document === 'string' ? source.document.replace(/\D/g, '') : '',
    phone: typeof source.phone === 'string' ? source.phone.replace(/\D/g, '') : '',
    documentType: 'cpf',
  };
  if (customer.phone.startsWith('55') && [12, 13].includes(customer.phone.length)) customer.phone = customer.phone.slice(2);
  const errors = {};
  if (!/^[\p{L}][\p{L}\p{M} .'-]{1,99}\s[\p{L}\p{M} .'-]+$/u.test(customer.name) || customer.name.length > 150) errors.name = 'Informe seu nome completo.';
  if (customer.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(customer.email)) errors.email = 'Informe um e-mail válido.';
  if (!validCpf(customer.document)) errors.document = 'Informe um CPF válido.';
  if (!/^[1-9]{2}(?:9\d{8}|[2-5]\d{7})$/.test(customer.phone)) errors.phone = 'Informe um telefone válido com DDD.';
  return { customer, errors };
}
