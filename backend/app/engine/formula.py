"""A small, safe formula language for amount rules. No eval, no attribute access, no calls except a whitelist.

Grammar:  expr := term (('+'|'-') term)* ; term := unary (('*'|'/') unary)* ; unary := '-' unary | atom
          atom := number | name | func '(' expr (',' expr)* ')' | '(' expr ')'
Numbers use '.' or ',' as the decimal mark ("0,03"); function arguments are separated by ';' or by ', ' with a space
("min(a; b)", "min(a, b)"). '×' and '÷' are accepted for * and /. Money is computed with Decimal
and rounded HALF_UP to tiyn at the end, so no float error accumulates."""
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

MAX_LEN = 300
MAX_DEPTH = 30
MAX_VALUE = Decimal("1e13")
FUNCS = {"min", "max", "round"}


class FormulaError(ValueError):
    def __init__(self, message: str, pos: int):
        super().__init__(f"{message} (позиция {pos + 1})")
        self.message, self.pos = message, pos


class MissingInput(Exception):
    """A variable exists but its value is unknown (e.g. no income): the amount is not computed, never 0."""

    def __init__(self, name: str):
        super().__init__(name)
        self.name = name


@dataclass
class Tok:
    kind: str  # num | name | op | lp | rp | comma | end
    value: str
    pos: int


def tokenize(src: str) -> list[Tok]:
    if len(src) > MAX_LEN:
        raise FormulaError(f"формула длиннее {MAX_LEN} символов", MAX_LEN)
    out: list[Tok] = []
    i = 0
    while i < len(src):
        c = src[i]
        if c.isspace():
            i += 1
        elif c.isdigit() or (c in ".," and i + 1 < len(src) and src[i + 1].isdigit()):
            j = i
            while j < len(src) and (src[j].isdigit() or (src[j] in ".," and j + 1 < len(src) and src[j + 1].isdigit())):
                j += 1
            raw = src[i:j].replace(",", ".")
            if raw.count(".") > 1:
                raise FormulaError("число записано неверно", i)
            out.append(Tok("num", raw, i))
            i = j
        elif c.isalpha() or c == "_":
            j = i
            while j < len(src) and (src[j].isalnum() or src[j] == "_"):
                j += 1
            out.append(Tok("name", src[i:j], i))
            i = j
        elif c in "+-*/×÷":
            out.append(Tok("op", {"×": "*", "÷": "/"}.get(c, c), i))
            i += 1
        elif c == "(":
            out.append(Tok("lp", c, i))
            i += 1
        elif c == ")":
            out.append(Tok("rp", c, i))
            i += 1
        elif c in ",;":
            out.append(Tok("comma", c, i))
            i += 1
        else:
            raise FormulaError(f"недопустимый символ «{c}»", i)
    out.append(Tok("end", "", len(src)))
    return out


class _Parser:
    def __init__(self, src: str, env: dict[str, Decimal | None], strict: bool):
        self.toks = tokenize(src)
        self.i = 0
        self.env = env
        self.strict = strict
        self.depth = 0
        self.used: set[str] = set()

    def peek(self) -> Tok:
        return self.toks[self.i]

    def take(self) -> Tok:
        t = self.toks[self.i]
        self.i += 1
        return t

    def expect(self, kind: str, message: str) -> Tok:
        t = self.take()
        if t.kind != kind:
            raise FormulaError(message, t.pos)
        return t

    def parse(self) -> Decimal:
        if self.peek().kind == "end":
            raise FormulaError("формула пустая", 0)
        v = self.expr()
        t = self.peek()
        if t.kind != "end":
            raise FormulaError("лишний символ", t.pos)
        return v

    def _guard(self, v: Decimal, pos: int) -> Decimal:
        if abs(v) > MAX_VALUE:
            raise FormulaError("слишком большое число", pos)
        return v

    def expr(self) -> Decimal:
        self.depth += 1
        if self.depth > MAX_DEPTH:
            raise FormulaError("слишком глубокая вложенность", self.peek().pos)
        v = self.term()
        while self.peek().kind == "op" and self.peek().value in "+-":
            op = self.take()
            r = self.term()
            v = self._guard(v + r if op.value == "+" else v - r, op.pos)
        self.depth -= 1
        return v

    def term(self) -> Decimal:
        v = self.unary()
        while self.peek().kind == "op" and self.peek().value in "*/":
            op = self.take()
            r = self.unary()
            if op.value == "/":
                if r == 0:
                    raise FormulaError("деление на ноль", op.pos)
                v = v / r
            else:
                v = v * r
            v = self._guard(v, op.pos)
        return v

    def unary(self) -> Decimal:
        t = self.peek()
        if t.kind == "op" and t.value in "+-":
            self.take()
            v = self.unary()
            return -v if t.value == "-" else v
        return self.atom()

    def atom(self) -> Decimal:
        t = self.take()
        if t.kind == "num":
            try:
                return self._guard(Decimal(t.value), t.pos)
            except InvalidOperation:
                raise FormulaError("число записано неверно", t.pos) from None
        if t.kind == "lp":
            v = self.expr()
            self.expect("rp", "не хватает закрывающей скобки «)»")
            return v
        if t.kind == "name":
            name = t.value.lower()
            if self.peek().kind == "lp":
                if name not in FUNCS:
                    raise FormulaError(f"неизвестная функция «{t.value}»", t.pos)
                self.take()
                args = [self.expr()]
                while self.peek().kind == "comma":
                    self.take()
                    args.append(self.expr())
                self.expect("rp", "не хватает закрывающей скобки «)»")
                if name == "round":
                    if len(args) > 2:
                        raise FormulaError("round принимает число и, по желанию, знаки после запятой", t.pos)
                    places = int(args[1]) if len(args) == 2 else 0
                    if not 0 <= places <= 2:
                        raise FormulaError("round: от 0 до 2 знаков", t.pos)
                    return args[0].quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP)
                return min(args) if name == "min" else max(args)
            if name not in self.env:
                raise FormulaError(f"неизвестная переменная «{t.value}»", t.pos)
            self.used.add(name)
            value = self.env[name]
            if value is None:
                if self.strict:
                    raise MissingInput(name)
                return Decimal(0)
            return value
        if t.kind == "end":
            raise FormulaError("формула оборвалась", t.pos)
        raise FormulaError(f"неожиданный символ «{t.value}»", t.pos)


def evaluate(src: str, env: dict[str, Decimal | None]) -> Decimal:
    """Tenge value rounded HALF_UP to tiyn. Raises FormulaError (with a position) or MissingInput."""
    v = _Parser(src, {k.lower(): v for k, v in env.items()}, strict=True).parse()
    return v.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def check(src: str, names: set[str]) -> set[str]:
    """Validate syntax and names without values; returns the variables the formula uses."""
    p = _Parser(src, {n.lower(): Decimal(1) for n in names}, strict=False)
    p.parse()
    return p.used
