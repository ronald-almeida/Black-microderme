export class PaymentError extends Error {
  constructor(code, status = 502, uncertain = false) {
    super(code);
    this.code = code;
    this.status = status;
    this.uncertain = uncertain;
  }
}
