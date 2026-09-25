# -*- coding: utf-8 -*-
"""
PMX 量具：贴图引用到底怎么存的、改起来要动什么。

按公开的 PMX 结构解析到**贴图表**，然后拿"这些路径在磁盘上找不找得到"当对齐校验——
结构只要错一个字节，读出来的路径就会是乱码、文件也找不到。这是最省事又最硬的判据。

用法：
  python tools/pmx-scan.py head <文件>      头部 + 全局设置 + 名字/注释
  python tools/pmx-scan.py tex <文件>       解析到贴图表，逐条打印（并核对文件在不在）
  python tools/pmx-scan.py stat <目录>       批量：多少份能解析干净、贴图缺多少
"""
import os
import struct
import sys

sys.stdout.reconfigure(errors="backslashreplace")


def 读(路):
    with open(路, "rb") as f:
        return f.read()


class 读器:
    def __init__(self, d, 编码):
        self.d = d
        self.o = 0
        self.编码 = 编码

    def u8(self):
        v = self.d[self.o]
        self.o += 1
        return v

    def i32(self):
        v = struct.unpack_from("<i", self.d, self.o)[0]
        self.o += 4
        return v

    def u32(self):
        v = struct.unpack_from("<I", self.d, self.o)[0]
        self.o += 4
        return v

    def f32(self):
        v = struct.unpack_from("<f", self.d, self.o)[0]
        self.o += 4
        return v

    def 跳(self, n):
        self.o += n

    def 索引(self, 大小):
        """顶点/贴图/材质索引：1 / 2 / 4 字节；有符号（-1 表示无）"""
        if 大小 == 1:
            v = struct.unpack_from("<b", self.d, self.o)[0]
        elif 大小 == 2:
            v = struct.unpack_from("<h", self.d, self.o)[0]
        else:
            v = struct.unpack_from("<i", self.d, self.o)[0]
        self.o += 大小
        return v

    def 串(self):
        """PMX 的字符串：int32 字节长度 + 内容（编码由头部决定）"""
        n = self.i32()
        if n < 0 or self.o + n > len(self.d):
            raise ValueError(f"字符串长度不合理：{n}（偏移 {self.o}）")
        b = self.d[self.o:self.o + n]
        self.o += n
        return b.decode(self.编码, "replace")


def 开(路):
    d = 读(路)
    if d[:4] != b"PMX ":
        raise ValueError(f"不是 PMX：{d[:4]!r}")
    版本 = struct.unpack_from("<f", d, 4)[0]
    全局数 = d[8]
    全局 = list(d[9:9 + 全局数])
    编码号 = 全局[0]
    编码 = "utf-16-le" if 编码号 == 0 else "utf-8"
    r = 读器(d, 编码)
    r.o = 9 + 全局数
    return d, 版本, 全局, 编码, r


def 打印头(路):
    d, 版本, 全局, 编码, r = 开(路)
    名 = {
        0: "编码(0=UTF-16LE,1=UTF-8)",
        1: "追加 UV 数",
        2: "顶点索引宽度",
        3: "贴图索引宽度",
        4: "材质索引宽度",
        5: "骨骼索引宽度",
        6: "morph 索引宽度",
        7: "刚体索引宽度",
    }
    print(f"{路}\n  大小 {len(d):,} 字节  版本 {版本}  全局数 {len(全局)}  字串编码 {编码}")
    for i, v in enumerate(全局):
        print(f"    [{i}] {名.get(i, '?'):<24} = {v}")
    本名 = r.串()
    通名 = r.串()
    注释 = r.串()
    注释英 = r.串()
    print(f"  本名 {本名!r}\n  通名 {通名!r}")
    print(f"  注释 {注释[:60]!r}{'…' if len(注释) > 60 else ''}")
    print(f"  注释英 {注释英[:60]!r}{'…' if len(注释英) > 60 else ''}")
    print(f"  读过注释后的偏移 = {r.o:,}")
    return d, 版本, 全局, 编码, r


def 走到贴图(路, 出声=True):
    d, 版本, 全局, 编码, r = 开(路)
    追加UV = 全局[1] if len(全局) > 1 else 0
    顶宽 = 全局[2]
    贴宽 = 全局[3]
    材宽 = 全局[4]
    骨宽 = 全局[5]
    r.串(); r.串(); r.串(); r.串()          # 四个名字/注释

    顶点数 = r.i32()
    if 出声:
        print(f"  顶点数 {顶点数:,}   追加UV {追加UV}   各索引宽度 顶点{顶宽} 贴图{贴宽} 材质{材宽} 骨骼{骨宽}")
    for _ in range(顶点数):
        r.跳(12 + 12 + 8 + 16 * 追加UV)     # 位置 + 法线 + UV + 追加UV
        权重类型 = r.u8()
        if 权重类型 == 0:      # BDEF1
            r.索引(骨宽)
        elif 权重类型 == 1:    # BDEF2
            r.索引(骨宽); r.索引(骨宽); r.跳(4)
        elif 权重类型 == 2:    # BDEF4
            for _ in range(4): r.索引(骨宽)
            r.跳(16)
        elif 权重类型 == 3:    # SDEF
            r.索引(骨宽); r.索引(骨宽)
            r.跳(36)          # C(3) + R0(3) + R1(3) 个 float
        elif 权重类型 == 4:    # QDEF
            for _ in range(4): r.索引(骨宽)
            r.跳(16)
        else:
            raise ValueError(f"不认识的权重类型 {权重类型}（偏移 {r.o - 1}）")
        r.跳(4)               # 边缘缩放

    面索引数 = r.i32()
    r.跳(面索引数 * 顶宽)

    贴图数 = r.i32()
    if 出声:
        print(f"  面索引 {面索引数:,} 个   贴图数 {贴图数}")
    表 = []
    for i in range(贴图数):
        表.append(r.串())
    return 表, r


def 看贴图(路):
    print(f"\n{路}")
    表, r = 走到贴图(路)
    目录 = os.path.dirname(路)
    在 = 0
    for i, p in enumerate(表):
        # PMX 里的贴图路径一般是相对 .pmx 所在目录的
        候选 = os.path.normpath(os.path.join(目录, p.replace("\\", os.sep)))
        有 = os.path.isfile(候选)
        在 += 1 if 有 else 0
        标记 = "有" if 有 else "缺"
        print(f"    [{i:>3}] {标记}  {p}")
    print(f"  贴图 {len(表)} 条，磁盘上找得到 {在} 条，缺 {len(表) - 在} 条   读完贴图表的偏移 = {r.o:,}")


def 走一遍(d, 编码, 全局, 顶点起, 顶点数, uv字节, 边缘字节, 骨宽, sdef, 顶宽):
    """按给定布局走完顶点区与面区，返回 (顶点区末, 面数, 贴图表起)"""
    步长 = {0: 骨宽, 1: 2 * 骨宽 + 4, 2: 4 * 骨宽 + 16, 3: 2 * 骨宽 + sdef, 4: 4 * 骨宽 + 16}
    o = 顶点起
    for _ in range(顶点数):
        o += 12 + 12 + uv字节
        if o >= len(d):
            raise ValueError("越界")
        类 = d[o]
        o += 1
        加 = 步长.get(类)
        if 加 is None:
            raise ValueError(f"权重类型 {类}")
        o += 加 + 边缘字节
        if o > len(d):
            raise ValueError("越界")
    面数 = struct.unpack_from("<i", d, o)[0]
    面末 = o + 4 + 面数 * 顶宽
    if 面末 + 4 > len(d):
        raise ValueError("面区越界")
    return o, 面数, 面末


def 取贴图(d, 编码, 贴图表起):
    贴图数 = struct.unpack_from("<i", d, 贴图表起)[0]
    if not (0 <= 贴图数 <= 4096):
        raise ValueError(f"贴图数 {贴图数} 不合理")
    r = 读器(d, 编码)
    r.o = 贴图表起 + 4
    return [r.串() for _ in range(贴图数)]


def 解析之一(路):
    """按标准布局解析；不行就换变体。返回 (布局说明, 贴图表)"""
    d, 版本, 全局, 编码, _ = 开(路)
    追加UV = 全局[1] if len(全局) > 1 else 0
    r = 读器(d, 编码)
    r.o = 9 + len(全局)
    for _ in range(4):
        r.串()
    顶点数 = struct.unpack_from("<i", d, r.o)[0]
    顶点起 = r.o + 4
    uv字节 = 8 + 16 * 追加UV
    顶宽 = 全局[2]
    骨宽 = 全局[5] if len(全局) > 5 else 1
    for 边, 边名 in ((4, ""), (0, "、无边缘缩放")):
        for sdef in (36, 40, 44):
            try:
                _, _, 面末 = 走一遍(d, 编码, 全局, 顶点起, 顶点数, uv字节, 边, 骨宽, sdef, 顶宽)
                表 = 取贴图(d, 编码, 面末)
                return f"SDEF={sdef}{边名}", 表
            except Exception:
                continue
    raise ValueError("没有一组布局能走完")


def 批量(根):
    import glob
    文件 = sorted(glob.glob(os.path.join(根, "**", "*.pmx"), recursive=True))
    抽 = 文件[:60] + 文件[len(文件) // 2: len(文件) // 2 + 60] + 文件[-60:]
    print(f"{根} 下 {len(文件)} 个 .pmx，抽查 {len(抽)} 份\n")
    布局 = {}
    好 = 0
    坏 = []
    贴图总 = 缺总 = 0
    for p in 抽:
        try:
            布局名, 表 = 解析之一(p)
        except Exception as e:
            坏.append((os.path.basename(p), str(e)))
            continue
        好 += 1
        布局[布局名] = 布局.get(布局名, 0) + 1
        目录 = os.path.dirname(p)
        贴图总 += len(表)
        for x in 表:
            if not os.path.isfile(os.path.normpath(os.path.join(目录, x.replace("\\", os.sep)))):
                缺总 += 1
    print(f"解析成功 {好}，失败 {len(坏)}")
    print("布局分布：")
    for k, v in sorted(布局.items(), key=lambda kv: -kv[1]):
        print(f"  {k:<24} {v} 份")
    if 贴图总:
        print(f"贴图引用 {贴图总} 条，磁盘上找不到 {缺总} 条（{缺总 / 贴图总 * 100:.1f}%）")
    for n, e in 坏[:8]:
        print(f"  失败：{n} —— {e}")


def 为什么(路):
    """解析失败时把失败点前后的字节打出来，看是不是错位"""
    d, 版本, 全局, 编码, r = 开(路)
    追加UV = 全局[1] if len(全局) > 1 else 0
    顶宽 = 全局[2]; 骨宽 = 全局[5]
    名字们 = []
    for _ in range(4):
        名字们.append(r.串())
    起 = r.o
    顶点数 = r.i32()
    print(f"  版本 {版本}  全局 {全局}  编码 {编码}")
    print(f"  四个名字/注释读完在 {起:,}；顶点数 {顶点数:,}") 
    每条 = 12 + 12 + 8 + 16 * 追加UV
    print(f"  顶点记录里固定部分 {每条} 字节（不含权重与边缘缩放）")
    for k in range(顶点数):
        起k = r.o
        try:
            r.跳(每条)
            类型 = r.u8()
            if k < 8:
                print(f"    第 {k} 个顶点：起点 {起k:,}  权重类型 {类型}")
            if 类型 == 0:
                r.索引(骨宽)
            elif 类型 == 1:
                r.索引(骨宽); r.索引(骨宽); r.跳(4)
            elif 类型 == 2:
                for _ in range(4): r.索引(骨宽)
                r.跳(16)
            elif 类型 == 3:
                r.索引(骨宽); r.索引(骨宽); r.跳(36)
            elif 类型 == 4:
                for _ in range(4): r.索引(骨宽)
                r.跳(16)
            else:
                raise ValueError(f"权重类型 {类型} 不认识（在偏移 {r.o - 1}，第 {k} 个顶点，起点 {起k}）")
            r.跳(4)
        except Exception as e:
            print(f"\n  第 {k} 个顶点就出问题：{e}")
            起打 = max(0, 起k - 24)
            for i in range(起打, min(起打 + 96, len(d)), 16):
                段 = d[i:i + 16]
                print(f"    {i:>10,}  {' '.join(f'{x:02X}' for x in 段):<47}  "
                      f"{''.join(chr(x) if 32 <= x < 127 else '.' for x in 段)}")
            return
    print(f"  一路顺到 {r.o:,}")


def 原始(路, 起, 长):
    d = 读(路)
    for i in range(起, min(起 + 长, len(d)), 16):
        段 = d[i:i + 16]
        print(f"{i:>10,}  {' '.join(f'{x:02X}' for x in 段):<47}  "
              f"{''.join(chr(x) if 32 <= x < 127 else '.' for x in 段)}")


def 拟合(路):
    """穷举顶点记录的布局参数，找出**能把整个顶点区走完**的那一组。

    为什么要它：野生的 .pmx 不都是一个模子出来的。手工推容易把巧合当结论
    （有个文件的第 4 个顶点开始偏，就是因为前面三条记录的尺寸凑巧也对得上）。
    这里要求"整段顶点全部合法"，再往下验面数与贴图表，才是硬判据。
    """
    d, 版本, 全局, 编码, r = 开(路)
    追加UV = 全局[1] if len(全局) > 1 else 0
    顶宽 = 全局[2]; 贴宽 = 全局[3]; 骨宽默认 = 全局[5]
    四个 = [r.串() for _ in range(4)]
    名字末 = r.o
    顶点数 = struct.unpack_from("<i", d, 名字末)[0]
    顶点起 = 名字末 + 4
    print(f"  版本 {版本}  全局 {全局}  顶点数 {顶点数:,}  顶点区起 {顶点起:,}")

    结果 = []
    for uv字节 in (8 + 16 * 追加UV, 16 + 16 * 追加UV):
        for 边缘字节 in (4, 0):
            for 骨宽 in (骨宽默认, 1, 2, 4):
                for sdef in (36, 40, 44):
                    步长 = {0: 骨宽, 1: 2 * 骨宽 + 4, 2: 4 * 骨宽 + 16, 3: 2 * 骨宽 + sdef, 4: 4 * 骨宽 + 16}
                    o = 顶点起
                    好 = True
                    for k in range(顶点数):
                        o += 12 + 12 + uv字节
                        if o >= len(d):
                            好 = False
                            break
                        类 = d[o]
                        o += 1
                        加 = 步长.get(类)
                        if 加 is None:
                            好 = False
                            break
                        o += 加 + 边缘字节
                        if o > len(d):
                            好 = False
                            break
                    if not 好:
                        continue
                    面数 = struct.unpack_from("<i", d, o)[0]
                    if not (0 <= 面数 < len(d)):
                        continue
                    面末 = o + 4 + 面数 * 顶宽
                    if 面末 + 4 > len(d):
                        continue
                    贴图数 = struct.unpack_from("<i", d, 面末)[0]
                    合理 = 0 <= 贴图数 <= 4096
                    结果.append((uv字节, 边缘字节, 骨宽, sdef, o, 面数, 面末, 贴图数, 合理))
    if not 结果:
        print("  没有一组能走完 —— 这个文件不是标准的 PMX 顶点布局")
        return
    print(f"  能走完的组合 {len(结果)} 组：")
    for uv, 边, 骨, sdef, o, 面数, 面末, 贴图, 合理 in 结果:
        print(f"    uv={uv}B 边缘={边}B 骨宽={骨} sdef={sdef}B → 顶点区末 {o:,} "
              f"面数 {面数:,} 贴图数 {贴图}{'  ← 贴图数合理' if 合理 else '  ✗ 贴图数不合理'}")
    # 真正对的那一组：贴图数合理、且贴图路径能在磁盘上找到
    目录 = os.path.dirname(路)
    最优 = None
    for uv, 边, 骨, sdef, o, 面数, 面末, 贴图, 合理 in 结果:
        if not 合理:
            continue
        try:
            rr = 读器(d, 编码)
            rr.o = 面末 + 4
            表 = [rr.串() for _ in range(贴图)]
        except Exception:
            continue
        真实 = sum(1 for x in 表 if os.path.isfile(os.path.normpath(os.path.join(目录, x.replace("\\", os.sep)))))
        if 表 and 真实 == len(表):
            最优 = (uv, 边, 骨, sdef, 表)
            break
        if 表 and 真实 >= len(表) // 2 and 最优 is None:
            最优 = (uv, 边, 骨, sdef, 表)
    if 最优:
        uv, 边, 骨, sdef, 表 = 最优
        print(f"\n  判定：uv={uv} 边缘缩放={边} 骨宽={骨} SDEF={sdef}，贴图 {len(表)} 条：")
        for i, x in enumerate(表[:12]):
            print(f"    [{i}] {x}")
    else:
        print("\n  贴图路径没能对上 —— 布局仍未定")


def 材质区(路, 出声=True):
    """解析到材质区：看材质是怎么引用贴图的（索引还是偏移）"""
    d, 版本, 全局, 编码, _ = 开(路)
    追加UV = 全局[1] if len(全局) > 1 else 0
    顶宽 = 全局[2]; 贴宽 = 全局[3]; 材宽 = 全局[4]; 骨宽 = 全局[5]; morph宽 = 全局[6]
    r = 读器(d, 编码)
    r.o = 9 + len(全局)
    for _ in range(4):
        r.串()
    顶点数 = r.i32()
    顶点起 = r.o
    uv字节 = 8 + 16 * 追加UV
    布局名, 表 = 解析之一(路)
    骨宽用 = 骨宽
    if "SDEF=40" in 布局名:
        sdef用 = 40
    elif "SDEF=44" in 布局名:
        sdef用 = 44
    else:
        sdef用 = 36
    边缘用 = 0 if "无边缘缩放" in 布局名 else 4
    _, 面数, 面末 = 走一遍(d, 编码, 全局, 顶点起, 顶点数, uv字节, 边缘用, 骨宽用, sdef用, 顶宽)
    # 贴图表之后才是材质区（面末 指向的就是贴图计数）
    rr = 读器(d, 编码)
    rr.o = 面末
    贴图数 = rr.i32()
    for _ in range(贴图数):
        rr.串()
    材数 = rr.i32()
    if 出声:
        print(f"  {路}\n  布局 {布局名}  贴图 {贴图数} 条  材质 {材数} 个（区起 {rr.o:,}）")
    引用 = []
    for i in range(材数):
        名 = rr.串(); 名英 = rr.串()
        rr.跳(4 * 4)          # 漫反射 rgba
        rr.跳(3 * 4)          # 高光 rgb
        rr.跳(4)              # 高光强度
        rr.跳(3 * 4)          # 环境光 rgb
        rr.u8()               # 绘制标志
        rr.跳(4 * 4)          # 边缘颜色
        rr.跳(4)              # 边缘大小
        贴图索引 = rr.索引(贴宽)
        球面索引 = rr.索引(贴宽)
        球面模式 = rr.u8()
        共用 = rr.u8()
        # 共用 toon 时 toonValue 只占 **1 字节**（共用色表的序号），不是贴图索引宽度
        if 共用:
            toon索引 = ("共用", rr.u8())
        else:
            toon索引 = rr.索引(贴宽)
        备注 = rr.串()
        面数 = rr.i32()
        引用.append((名, 贴图索引, 球面索引, toon索引, 面数))
        if 出声 and i < 12:
            print(f"    [{i:>3}] {名!r:<28} 贴图#{贴图索引:<5} 球面#{球面索引:<5} toon#{toon索引!s:<6} 面 {面数}")
    if 出声 and 材数 > 12:
        print(f"    … 共 {材数} 个材质")
    return 引用, rr.o


def 改路径(路, 出, 旧, 新):
    """把贴图表里的一条路径换成另一条（长度可以不同），再重新解析一遍验证。

    这一步回答的是"改路径要不要动后面的偏移"——PMX 里所有引用都是**索引**，
    不是文件偏移，所以理论上只改字节、长度变了就整体平移。这里拿真文件验。
    """
    d = 读(路)
    布局名, 表 = 解析之一(路)
    if 旧 not in 表:
        print(f"  贴图表里没有 {旧!r}；实际有：{表}")
        return
    i = 表.index(旧)
    # 先定位贴图表
    _引用, _ = 材质区(路, 出声=False)
    # 用同样的走法拿到贴图表起点
    d2, 版本, 全局, 编码, _x = 开(路)
    r = 读器(d2, 编码)
    r.o = 9 + len(全局)
    for _ in range(4):
        r.串()
    顶点数 = r.i32()
    顶点起 = r.o
    边缘用 = 0 if "无边缘缩放" in 布局名 else 4
    sdef用 = 40 if "SDEF=40" in 布局名 else (44 if "SDEF=44" in 布局名 else 36)
    _, _, 面末 = 走一遍(d2, 编码, 全局, 顶点起, 顶点数, 8 + 16 * 全局[1], 边缘用, 全局[5], sdef用, 全局[2])
    rr = 读器(d2, 编码)
    rr.o = 面末
    贴图数 = rr.i32()
    起点 = []
    for k in range(贴图数):
        起 = rr.o
        长度 = struct.unpack_from("<i", d2, rr.o)[0]
        rr.o += 4 + 长度
        起点.append((起, 长度))
    起, 长度 = 起点[i]
    编 = "utf-16-le" if 编码 == "utf-16-le" else "utf-8"
    新字节 = 新.encode(编)
    新块 = struct.pack("<i", len(新字节)) + 新字节
    改后 = d[:起] + 新块 + d[起 + 4 + 长度:]
    with open(出, "wb") as f:
        f.write(改后)
    print(f"  写副本 {出}")
    print(f"    第 {i} 条：{旧!r}（{长度} 字节）→ {新!r}（{len(新字节)} 字节）")
    print(f"    文件 {len(d):,} → {len(改后):,} 字节（差 {len(改后) - len(d):+,}）")
    # 重新解析，比材质引用
    _引用2, _ = 材质区(出, 出声=False)
    布局2, 表2 = 解析之一(出)
    print(f"    副本重解析：布局 {布局2}  贴图 {len(表2)} 条（原 {len(表)} 条）")
    print(f"    副本第 {i} 条现在是 {表2[i]!r}")
    同 = (len(表2) == len(表)) and all(a == b for k, (a, b) in enumerate(zip(表, 表2)) if k != i) and 表2[i] == 新
    print(f"    其余贴图与旧文件逐条一致：{'是' if 同 else '否'}")
    if len(_引用) == len(_引用2):
        差 = [k for k, (a, b) in enumerate(zip(_引用, _引用2)) if a != b]
        print(f"    材质数一致（{len(_引用)}），引用发生变化的材质：{差 if 差 else '没有（索引没动）'}")


def 找(路, 文本):
    """按两种编码搜字符串，并把后面的字节打出来（看它后面跟的是浮点还是别的）"""
    import struct as _s
    d = 读(路)
    print(f"{路}  {len(d):,} 字节   找 {文本!r}\n")
    for 编码 in ("utf-16-le", "utf-8"):
        b = 文本.encode(编码)
        起 = 0
        命中 = []
        while True:
            i = d.find(b, 起)
            if i < 0:
                break
            命中.append(i)
            起 = i + 1
        if not 命中:
            continue
        print(f"  {编码}：{len(命中)} 处 {命中[:8]}")
        for i in 命中[:4]:
            后 = d[i + len(b):i + len(b) + 24]
            # 后面 3 个 float 是不是合理（骨头名后面应当跟位置）
            浮 = [_s.unpack_from("<f", d, i + len(b) + k * 4)[0] for k in range(3)]
            合理 = all(abs(x) < 1e4 for x in 浮) and any(abs(x) > 1e-6 for x in 浮)
            print(f"    @{i:,}  后24字节 {后.hex(' ')}")
            print(f"          当 3 个 float 读 = {[round(x, 3) for x in 浮]}  "
                  f"{'← 像骨头的位置' if 合理 else '← 不像位置'}")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    m, f = sys.argv[1], sys.argv[2]
    if m == "head":
        打印头(f)
    elif m == "tex":
        看贴图(f)
    elif m == "stat":
        批量(f)
    elif m == "why":
        为什么(f)
    elif m == "fit":
        拟合(f)
    elif m == "mat":
        材质区(f)
    elif m == "找":
        找(f, sys.argv[3])
    elif m == "改":
        改路径(f, sys.argv[3], sys.argv[4], sys.argv[5])
    elif m == "raw":
        原始(f, int(sys.argv[3]), int(sys.argv[4]) if len(sys.argv) > 4 else 128)
    else:
        print(__doc__)
