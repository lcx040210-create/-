# 北岭闸口 · 出图清单（人物 / 场景 分图层）

> **分图层**：人物单独生成（透明背景或纯白/纯绿背景，方便抠图），场景单独生成（无人）。生成后我负责组合图层。
> 下载后放进 `northridge-gate/public/assets/` 对应子目录（characters / scenes / exec / env / room）。
> **画幅**：人物竖版（portrait）；场景按用途（立绘背景竖版 / 处决帧横版 16:9）。
> 每条含完整【前缀 + 正文 + 后缀】+ `NEGATIVE:` 负面词。Perchance 里把 NEGATIVE 填进 negative 框。

---

## 一、人物图层（characters/，竖版，透明或纯色背景）

> 人物只画人，不要背景、不要场景、不要房间。背景用**纯白**或**透明**（方便抠图组合）。

### v1_human.png — Dispatcher · Daniel Cole (human)
```
isolated half-body character portrait, tired middle-aged facility dispatcher in a worn uniform, rain-soaked and uneasy but fully human, warm skin, normal proportions, weary eyes, standing facing forward, cutout style, plain white background, character only, no scene, no window, no room, cinematic lighting, grain, VHS
NEGATIVE: no text, no watermark, no signature, no logo, no background scene, no window, no room, deformed, bad anatomy, extra fingers, extra limbs, extra digits, mutated, cartoon, anime, manga, flat illustration, vector art, pixel art, blurry, low quality, low resolution, oversaturated, plastic, glossy, childish
```

### v2_skinfit_frame1.png — Maintenance · Marcus Reed (skin-fit)
```
isolated half-body character portrait, maintenance worker in dark coveralls and a low-brim hard hat, skin too smooth and tight like a mask stretched over something, a thin faint seam line running from behind the right ear down the neck, eyes mid-blink out of sync, one pupil larger than the other, standing facing forward, cutout style, plain white background, character only, no scene, no window, no room, cinematic lighting, grain, VHS
NEGATIVE: no text, no watermark, no signature, no logo, no background scene, no window, no room, deformed, bad anatomy, extra fingers, extra limbs, extra digits, mutated, cartoon, anime, manga, flat illustration, vector art, pixel art, blurry, low quality, low resolution, oversaturated, plastic, glossy, childish
```

### v3_suspicious_frame1.png — Visitor · Sam Whitfield (human who looks like a pseudo)
```
isolated half-body character portrait, nervous young visitor, wide darting eyes and twitchy posture that reads wrong but on closer look fully human, rain-damp hair, anxious, no seams no wrongness just fear, standing facing forward, cutout style, plain white background, character only, no scene, no window, no room, cinematic lighting, grain, VHS
NEGATIVE: no text, no watermark, no signature, no logo, no background scene, no window, no room, deformed, bad anatomy, extra fingers, extra limbs, extra digits, mutated, cartoon, anime, manga, flat illustration, vector art, pixel art, blurry, low quality, low resolution, oversaturated, plastic, glossy, childish
```

### v4_coretick_frame1.png — Relief · Victor Hale (core-tick)
```
isolated half-body character portrait, relief worker, unnervingly still, too-clean uniform, a faint metallic glint and subtle ticking bulge under the collarbone, flat calm expression, unblinking eyes, standing facing forward, cutout style, plain white background, character only, no scene, no window, no room, cinematic lighting, grain, VHS
NEGATIVE: no text, no watermark, no signature, no logo, no background scene, no window, no room, deformed, bad anatomy, extra fingers, extra limbs, extra digits, mutated, cartoon, anime, manga, flat illustration, vector art, pixel art, blurry, low quality, low resolution, oversaturated, plastic, glossy, childish
```

---

## 二、场景图层（scenes/，无人）

### window_scene.png — 观察窗背景（竖版，立绘用）
```
first-person horror game, empty observation window of a 1990s research outpost booth, grimy reinforced glass, night and rain outside, distant yellow streetlight, condensation and cracks on the glass, no person, no character, background only, cinematic lighting, grain, VHS, no text, no watermark
NEGATIVE: no person, no human, no character, no creature, no text, no watermark, no signature, no logo, cartoon, anime, manga, flat illustration, vector art, pixel art, blurry, low quality, low resolution, oversaturated, plastic, glossy
```

### corridor_scene.png — 走廊背景（处决/失败用，横版 16:9）
```
first-person horror game, empty dark facility corridor beyond a checkpoint window, grimy concrete, fluorescent flicker, distant doorway, no person, no character, background only, cinematic lighting, grain, VHS, no text, no watermark
NEGATIVE: no person, no human, no character, no creature, no text, no watermark, no signature, no logo, cartoon, anime, manga, flat illustration, vector art, pixel art, blurry, low quality, low resolution, oversaturated, plastic, glossy
```

---

## 三、处决帧（exec/，横版 16:9，人物+场景一体的动作镜头）

### exec_axe_1..4.png — 消防斧
```
first-person horror game cutscene, looking through a reinforced checkpoint window, 1990s research outpost, grimy glass, fluorescent flicker, stop-motion creature that only looks human, not a real person, practical gore effects, wet viscera and dark arterial spray as alien tissue, cinematic lighting, grain, VHS, no text, no watermark — fire axe chopping through a doppelganger torso at a checkpoint hatch, body folds open in two heavy slabs of meat-like tissue, cascade of blood and dangling viscera over the window ledge, black core visible in the split, stop-motion frames skipping, industrial horror cinematic — horror game cinematic, grotesque but stylized, creature anatomy tearing apart, heavy blood mist on glass, chunks of pale tissue and black ichor, terrified atmosphere, 35mm, high detail
NEGATIVE: no text, no watermark, no signature, no logo, deformed, bad anatomy, extra fingers, extra limbs, extra digits, mutated, cartoon, anime, manga, flat illustration, vector art, pixel art, blurry, low quality, low resolution, oversaturated, plastic, glossy, childish
```

### exec_gun_1..4.png — 手枪（头核）
```
first-person horror game cutscene, looking through a reinforced checkpoint window, 1990s research outpost, grimy glass, fluorescent flicker, stop-motion creature that only looks human, not a real person, practical gore effects, wet viscera and dark arterial spray as alien tissue, cinematic lighting, grain, VHS, no text, no watermark — close-up through cracked booth glass, security guard's pistol muzzle in foreground out of focus, a skin-fit doppelganger's head snaps back as a dark core bursts from the temple, fountain of black-red blood and shredded pale tissue hitting the glass in slow droplets, one eye still blinking out of sync, stop-motion judder, wet gore on the window — horror game cinematic, grotesque but stylized, creature anatomy tearing apart, heavy blood mist on glass, chunks of pale tissue and black ichor, terrified atmosphere, 35mm, high detail
NEGATIVE: no text, no watermark, no signature, no logo, deformed, bad anatomy, extra fingers, extra limbs, extra digits, mutated, cartoon, anime, manga, flat illustration, vector art, pixel art, blurry, low quality, low resolution, oversaturated, plastic, glossy, childish
```

### exec_fail_1..4.png — 失败分支（东西还站着）
```
first-person horror game cutscene, looking through a reinforced checkpoint window, 1990s research outpost, grimy glass, fluorescent flicker, stop-motion creature that only looks human, not a real person, practical gore effects, wet viscera and dark arterial spray as alien tissue, cinematic lighting, grain, VHS, no text, no watermark — the doppelganger flinches then stands back up unharmed, wrong-jointed limbs straightening with a stop-motion twitch, turns and shambles down the dark corridor away from the window, smeared handprint left on the glass — horror game cinematic, grotesque but stylized, terrified atmosphere, 35mm, high detail
NEGATIVE: no text, no watermark, no signature, no logo, deformed, bad anatomy, extra fingers, extra limbs, extra digits, mutated, cartoon, anime, manga, flat illustration, vector art, pixel art, blurry, low quality, low resolution, oversaturated, plastic, glossy, childish
```

---

## 四、环境 & 房间贴图（无人）

### corridor_silhouette.png（env/）— 开场剪影
```
first-person horror game, looking through a reinforced checkpoint window, 1990s research outpost, grimy glass, fluorescent flicker, cinematic lighting, grain, VHS, no text, no watermark — a single dark human-shaped silhouette standing motionless outside the window in the rain and night, backlit by a distant flickering light, featureless, menacing — horror game still, terrified atmosphere, 35mm, high detail, portrait orientation
NEGATIVE: no text, no watermark, no signature, no logo, deformed, bad anatomy, cartoon, anime, manga, flat illustration, vector art, pixel art, blurry, low quality, low resolution, oversaturated, plastic, glossy, childish
```

### shoes_hallucination.png（env/）— 幻觉多一双鞋
```
first-person horror game, 1990s research outpost, grimy concrete corridor at night, fluorescent flicker, cinematic lighting, grain, VHS, no text, no watermark — an empty dim corridor, but an extra pair of worn shoes stands by themselves on the floor, arranged as if someone invisible is wearing them, subtle, unsettling — horror game still, terrified atmosphere, 35mm, high detail
NEGATIVE: no text, no watermark, no signature, no logo, deformed, bad anatomy, cartoon, anime, manga, flat illustration, vector art, pixel art, blurry, low quality, low resolution, oversaturated, plastic, glossy, childish
```

### window_residue_axe.png / gun / fire（env/）— 玻璃残渣
```
first-person horror game, close-up of a grimy reinforced checkpoint window, 1990s research outpost, fluorescent flicker, cinematic lighting, grain, VHS, no text, no watermark — a thin dark axe-edge smear and a streak of dried blood along the inside sill of the empty glass, no creature visible — horror game still, terrified atmosphere, 35mm, high detail
NEGATIVE: no text, no watermark, no signature, no logo, deformed, bad anatomy, cartoon, anime, manga, flat illustration, vector art, pixel art, blurry, low quality, low resolution, oversaturated, plastic, glossy, childish
```

### wall.png / floor.png / sofa.png / metal.png / wood.png（room/）— 房间贴图
```
interior wall of an observation booth, 1990s research outpost, grimy concrete wall with peeling paint and stains, a large reinforced observation window in the center with metal frame and rivets, night and rain visible through the glass, condensation and cracks, no person, no character, cinematic lighting, grain, VHS, no text, no watermark
NEGATIVE: no person, no human, no character, no text, no watermark, no signature, no logo, cartoon, anime, flat illustration, vector art, pixel art, blurry, low quality, low resolution, oversaturated, plastic, glossy
```

---

## 过审替换（平台审暴力时用）

- `blood` → `black ichor`
- `viscera` / `tissue` → `alien pulp`
- 主体始终写 `doppelganger / impostor creature`
