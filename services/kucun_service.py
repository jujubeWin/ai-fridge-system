from datetime import datetime
from decimal import Decimal, InvalidOperation

from db import query, transaction


class KucunError(Exception):
    """Business error for inbound / outbound operations."""


def _to_qty(value):
    try:
        qty = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise KucunError("数量格式不正确") from exc
    if qty <= 0:
        raise KucunError("数量必须大于 0")
    return qty


def _normalize_source(source):
    value = (source or "manual").strip().lower()
    if value not in ("manual", "vision"):
        raise KucunError("入库方式只能是 manual 或 vision")
    return value


def inbound(payload):
    name = (payload.get("name") or "").strip()
    if not name:
        raise KucunError("食材名称不能为空")

    qty = _to_qty(payload.get("shuliang"))
    source = _normalize_source(payload.get("source"))
    fenlei = payload.get("fenlei") or None
    expire_date = payload.get("expire_date") or None
    location = payload.get("location") or None
    image_path = payload.get("image_path") or None
    now = datetime.now()

    with transaction() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO kucun
                    (name, fenlei, shuliang, expire_date, location, source, image_path, created_at)
                VALUES
                    (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (name, fenlei, qty, expire_date, location, source, image_path, now),
            )
            kucun_id = cursor.lastrowid
            cursor.execute(
                """
                INSERT INTO kucun_log
                    (kucun_id, name, fenlei, shuliang, expire_date, action, dtime, created_at, reason)
                VALUES
                    (%s, %s, %s, %s, %s, 'in', %s, %s, %s)
                """,
                (kucun_id, name, fenlei, qty, expire_date, now, now, None),
            )

    return {
        "kucun_id": kucun_id,
        "name": name,
        "shuliang": str(qty),
        "created_at": now.strftime("%Y-%m-%d %H:%M:%S"),
    }


def outbound(payload):
    name = (payload.get("name") or "").strip()
    if not name:
        raise KucunError("食材名称不能为空")

    need = _to_qty(payload.get("shuliang"))
    reason = payload.get("reason") or None
    now = datetime.now()
    remaining = need
    deducted = []

    with transaction() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, name, fenlei, shuliang, expire_date, location, source, image_path, created_at
                FROM kucun
                WHERE name = %s
                ORDER BY expire_date ASC, created_at ASC
                FOR UPDATE
                """,
                (name,),
            )
            batches = cursor.fetchall()
            total = sum((row["shuliang"] for row in batches), Decimal("0"))
            if total < remaining:
                raise KucunError(f"库存不足：当前 {name} 共 {total}，需要 {need}")

            for batch in batches:
                if remaining <= 0:
                    break
                stock = Decimal(str(batch["shuliang"]))
                take = stock if stock <= remaining else remaining

                cursor.execute(
                    """
                    INSERT INTO kucun_log
                        (kucun_id, name, fenlei, shuliang, expire_date, action, dtime, created_at, reason)
                    VALUES
                        (%s, %s, %s, %s, %s, 'out', %s, %s, %s)
                    """,
                    (
                        batch["id"],
                        batch["name"],
                        batch["fenlei"],
                        take,
                        batch["expire_date"],
                        now,
                        batch["created_at"],
                        reason,
                    ),
                )

                leftover = stock - take
                if leftover <= 0:
                    cursor.execute("DELETE FROM kucun WHERE id = %s", (batch["id"],))
                else:
                    cursor.execute(
                        "UPDATE kucun SET shuliang = %s WHERE id = %s",
                        (leftover, batch["id"]),
                    )

                deducted.append(
                    {
                        "kucun_id": batch["id"],
                        "shuliang": str(take),
                        "expire_date": str(batch["expire_date"]) if batch["expire_date"] else None,
                        "cleared": leftover <= 0,
                    }
                )
                remaining -= take

    return {
        "name": name,
        "shuliang": str(need),
        "dtime": now.strftime("%Y-%m-%d %H:%M:%S"),
        "batches": deducted,
    }


def list_kucun():
    return query(
        """
        SELECT id, name, fenlei, shuliang, expire_date, location, source, image_path, created_at
        FROM kucun
        ORDER BY expire_date ASC, created_at ASC
        """
    )


def list_logs(limit=100):
    return query(
        """
        SELECT id, kucun_id, name, fenlei, shuliang, expire_date, action, dtime, created_at, reason
        FROM kucun_log
        ORDER BY dtime DESC, id DESC
        LIMIT %s
        """,
        (int(limit),),
    )
