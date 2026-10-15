import json  # 👈 移到最顶部
from decimal import Decimal
from datetime import date, datetime

from flask import Flask, jsonify, render_template, request

from db import query_one
from services.kucun_service import KucunError, inbound, list_kucun, list_logs, outbound

import requests
import config

app = Flask(__name__)
app.config["JSON_AS_ASCII"] = False


def _json_safe(value):
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat(sep=" ") if isinstance(value, datetime) else value.isoformat()
    if isinstance(value, dict):
        return {key: _json_safe(val) for key, val in value.items()}
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    return value


@app.route("/")
def index():
    return render_template("index.html")


@app.get("/api/health")
def health():
    try:
        row = query_one("SELECT 1 AS ok")
        db_ok = bool(row and row.get("ok") == 1)
        return jsonify({"ok": True, "flask": True, "mysql": db_ok})
    except Exception as exc:
        return jsonify({"ok": False, "flask": True, "mysql": False, "error": str(exc)}), 500


@app.get("/api/kucun")
def kucun_list():
    return jsonify({"ok": True, "data": _json_safe(list_kucun())})


@app.get("/api/kucun/log")
def kucun_log_list():
    try:
        limit = int(request.args.get("limit", 100))
    except (TypeError, ValueError):
        limit = 100
    return jsonify({"ok": True, "data": _json_safe(list_logs(limit))})


@app.post("/api/kucun/in")
def kucun_in():
    payload = request.get_json(silent=True) or {}
    try:
        result = inbound(payload)
        return jsonify({"ok": True, "data": result})
    except KucunError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.post("/api/kucun/out")
def kucun_out():
    payload = request.get_json(silent=True) or {}
    try:
        result = outbound(payload)
        return jsonify({"ok": True, "data": result})
    except KucunError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


# ================== 新增：AI 菜谱推荐接口 ==================
@app.get("/api/ai/recipe")
def get_ai_recipe():
    api_key = config.ZHIPU_API_KEY
    if not api_key:
        return jsonify({"ok": False, "error": "未配置 ZHIPU_API_KEY，请检查 .env 文件"}), 500

    try:
        items = list_kucun()
    except Exception as e:
        return jsonify({"ok": False, "error": f"数据库读取失败: {str(e)}"}), 500

    if not items:
        return jsonify({"ok": False, "error": "冰箱里暂时没有食材，先去入库吧！"}), 400

    food_list = "、".join([f"{item.get('name')}({item.get('shuliang')}份, {item.get('fenlei')})" for item in items])

        # 读取个性化参数
    avoid = request.args.get('avoid', '').strip()
    prefer = request.args.get('prefer', '').strip()

    # 动态构建 Prompt
    prompt = f"""
    你是一个专业的家常菜谱助手。我现在的冰箱里有以下食材：
    {food_list}
    """
    
    if avoid:
        prompt += f"\n⚠️ 用户有严格忌口/过敏，菜谱中绝对不能包含：{avoid}。\n"
    if prefer:
        prompt += f"\n⭐ 用户特别想吃：{prefer}，请优先推荐此类口味或类型的菜肴。\n"

    prompt += f"""
    请根据这些食材（不需要额外购买太多东西），为我推荐 2-3 道家常菜。
    请严格按照以下 JSON 数组格式返回（不要包含任何 Markdown 标记，如 ```json）：
    [
      {{
        "name": "菜名",
        "ingredients": ["需要的食材1", "需要的食材2"],
        "steps": ["步骤1", "步骤2", "步骤3"]
      }}
    ]
    """

    url = "https://open.bigmodel.cn/api/paas/v4/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": "glm-4-flash",  # 换成这个最稳定的经典免费模型
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.7
    }

    try:
        # 👇 关键修复：手动转成 UTF-8 编码的 JSON 字符串，用 data 发送，避免 Windows 环境下的 latin-1 编码错误
        payload_json = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        response = requests.post(url, headers=headers, data=payload_json, timeout=(10, 120))
        res_data = response.json()
        
        if "choices" not in res_data:
            return jsonify({"ok": False, "error": f"AI 接口返回异常: {res_data.get('error', {}).get('message', '未知错误')}"}), 500
            
        ai_text = res_data["choices"][0]["message"]["content"]
        ai_text = ai_text.replace("```json", "").replace("```", "").strip()
        
        recipes = json.loads(ai_text)
        return jsonify({"ok": True, "data": recipes})

    except json.JSONDecodeError:
        return jsonify({"ok": False, "error": "AI 返回格式混乱，请重试"}), 500
    except Exception as e:
        return jsonify({"ok": False, "error": f"请求失败: {str(e)}"}), 500
# ==========================================================

# ================== 新增：AI 智能采购建议接口 ==================
@app.get("/api/ai/shopping")
def get_ai_shopping():
    api_key = config.ZHIPU_API_KEY
    if not api_key:
        return jsonify({"ok": False, "error": "未配置 ZHIPU_API_KEY，请检查 .env 文件"}), 500

    try:
        items = list_kucun()
    except Exception as e:
        return jsonify({"ok": False, "error": f"数据库读取失败: {str(e)}"}), 500

    if not items:
        return jsonify({"ok": False, "error": "冰箱里暂时没有食材，先去入库吧！"}), 400

    # 整理现有食材清单
    food_list = "、".join([f"{item.get('name')}({item.get('shuliang')}份, {item.get('fenlei')})" for item in items])

    prompt = f"""
    你是一个专业的家庭采购和膳食规划助手。我现在的冰箱里有以下食材：
    {food_list}
    
    请根据现有库存，为我推荐 3-4 种需要采购的食材（例如：缺少某种营养、缺乏某类调料、或者有食材快用完了）。
    
    请严格按照以下 JSON 数组格式返回（不要包含任何 Markdown 标记，如 ```json）：
    [
      {{
        "name": "推荐购买的食材名",
        "reason": "推荐购买的理由（结合现有食材情况，比如营养搭配、缺少调料等）",
        "recipes": ["购买后搭配现有食材可以做成的菜名1", "菜名2"]
      }}
    ]
    """

    url = "https://open.bigmodel.cn/api/paas/v4/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": "glm-4-flash",
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.7
    }

    try:
        payload_json = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        response = requests.post(url, headers=headers, data=payload_json, timeout=(10, 120))
        res_data = response.json()
        
        if "choices" not in res_data:
            return jsonify({"ok": False, "error": f"AI 接口返回异常: {res_data.get('error', {}).get('message', '未知错误')}"}), 500
            
        ai_text = res_data["choices"][0]["message"]["content"]
        ai_text = ai_text.replace("```json", "").replace("```", "").strip()
        
        shopping_list = json.loads(ai_text)
        return jsonify({"ok": True, "data": shopping_list})

    except json.JSONDecodeError:
        return jsonify({"ok": False, "error": "AI 返回格式混乱，请重试"}), 500
    except Exception as e:
        return jsonify({"ok": False, "error": f"请求失败: {str(e)}"}), 500
# ==========================================================


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)