# 北岭闸口 · Perchance 出图操作清单

## 操作步骤（每个图都一样）

1. 点开下面的链接（prompt 已自动填好）
2. 把【负面 prompt】粘进 Perchance 的 negative 框（如果链接没自动填 negative）
3. 画幅：人物/场景竖版 portrait；处决帧横版 16:9（在 Perchance 画幅设置里选）
4. 点 Generate，出图后右键下载
5. 重命名为对应文件名，放进 `northridge-gate/public/assets/<目录>/`
6. 伪人定格帧（v2/v3/v4）：同一 prompt 出 5 次 = frame1..5

---

## v1_human（characters/）

**链接**：https://perchance.org/ai-image-generator?prompt=isolated%20half-body%20character%20portrait%2C%20tired%20middle-aged%20facility%20dispatcher%20in%20a%20worn%20uniform%2C%20rain-soaked%20and%20uneasy%20but%20fully%20human%2C%20warm%20skin%2C%20normal%20proportions%2C%20weary%20eyes%2C%20standing%20facing%20forward%2C%20cutout%20style%2C%20plain%20white%20background%2C%20character%20only%2C%20no%20scene%2C%20no%20window%2C%20no%20room%2C%20cinematic%20lighting%2C%20grain%2C%20VHS

**负面 prompt**（粘进 negative 框）：

```
no text, no watermark, no signature, no logo, no background scene, no window, no room, deformed, bad anatomy, extra fingers, extra limbs, extra digits, mutated, cartoon, anime, manga, flat illustration, vector art, pixel art, blurry, low quality, low resolution, oversaturated, plastic, glossy, childish
```

---

## v2_skinfit_frame1（characters/）

**链接**：https://perchance.org/ai-image-generator?prompt=isolated%20half-body%20character%20portrait%2C%20maintenance%20worker%20in%20dark%20coveralls%20and%20a%20low-brim%20hard%20hat%2C%20skin%20too%20smooth%20and%20tight%20like%20a%20mask%20stretched%20over%20something%2C%20a%20thin%20faint%20seam%20line%20running%20from%20behind%20the%20right%20ear%20down%20the%20neck%2C%20eyes%20mid-blink%20out%20of%20sync%2C%20one%20pupil%20larger%20than%20the%20other%2C%20standing%20facing%20forward%2C%20cutout%20style%2C%20plain%20white%20background%2C%20character%20only%2C%20no%20scene%2C%20no%20window%2C%20no%20room%2C%20cinematic%20lighting%2C%20grain%2C%20VHS

**负面 prompt**（粘进 negative 框）：

```
no text, no watermark, no signature, no logo, no background scene, no window, no room, deformed, bad anatomy, extra fingers, extra limbs, extra digits, mutated, cartoon, anime, manga, flat illustration, vector art, pixel art, blurry, low quality, low resolution, oversaturated, plastic, glossy, childish
```

---

## v3_suspicious_frame1（characters/）

**链接**：https://perchance.org/ai-image-generator?prompt=isolated%20half-body%20character%20portrait%2C%20nervous%20young%20visitor%2C%20wide%20darting%20eyes%20and%20twitchy%20posture%20that%20reads%20wrong%20but%20on%20closer%20look%20fully%20human%2C%20rain-damp%20hair%2C%20anxious%2C%20no%20seams%20no%20wrongness%20just%20fear%2C%20standing%20facing%20forward%2C%20cutout%20style%2C%20plain%20white%20background%2C%20character%20only%2C%20no%20scene%2C%20no%20window%2C%20no%20room%2C%20cinematic%20lighting%2C%20grain%2C%20VHS

**负面 prompt**（粘进 negative 框）：

```
no text, no watermark, no signature, no logo, no background scene, no window, no room, deformed, bad anatomy, extra fingers, extra limbs, extra digits, mutated, cartoon, anime, manga, flat illustration, vector art, pixel art, blurry, low quality, low resolution, oversaturated, plastic, glossy, childish
```

---

## v4_coretick_frame1（characters/）

**链接**：https://perchance.org/ai-image-generator?prompt=isolated%20half-body%20character%20portrait%2C%20relief%20worker%2C%20unnervingly%20still%2C%20too-clean%20uniform%2C%20a%20faint%20metallic%20glint%20and%20subtle%20ticking%20bulge%20under%20the%20collarbone%2C%20flat%20calm%20expression%2C%20unblinking%20eyes%2C%20standing%20facing%20forward%2C%20cutout%20style%2C%20plain%20white%20background%2C%20character%20only%2C%20no%20scene%2C%20no%20window%2C%20no%20room%2C%20cinematic%20lighting%2C%20grain%2C%20VHS

**负面 prompt**（粘进 negative 框）：

```
no text, no watermark, no signature, no logo, no background scene, no window, no room, deformed, bad anatomy, extra fingers, extra limbs, extra digits, mutated, cartoon, anime, manga, flat illustration, vector art, pixel art, blurry, low quality, low resolution, oversaturated, plastic, glossy, childish
```

---

## window_scene（scenes/）

**链接**：https://perchance.org/ai-image-generator?prompt=first-person%20horror%20game%2C%20empty%20observation%20window%20of%20a%201990s%20research%20outpost%20booth%2C%20grimy%20reinforced%20glass%2C%20night%20and%20rain%20outside%2C%20distant%20yellow%20streetlight%2C%20condensation%20and%20cracks%20on%20the%20glass%2C%20no%20person%2C%20no%20character%2C%20background%20only%2C%20cinematic%20lighting%2C%20grain%2C%20VHS%2C%20no%20text%2C%20no%20watermark

**负面 prompt**（粘进 negative 框）：

```
no person, no human, no character, no creature, no text, no watermark, no signature, no logo, cartoon, anime, manga, flat illustration, vector art, pixel art, blurry, low quality, low resolution, oversaturated, plastic, glossy
```

---

## corridor_scene（scenes/）

**链接**：https://perchance.org/ai-image-generator?prompt=first-person%20horror%20game%2C%20empty%20dark%20facility%20corridor%20beyond%20a%20checkpoint%20window%2C%20grimy%20concrete%2C%20fluorescent%20flicker%2C%20distant%20doorway%2C%20no%20person%2C%20no%20character%2C%20background%20only%2C%20cinematic%20lighting%2C%20grain%2C%20VHS%2C%20no%20text%2C%20no%20watermark

**负面 prompt**（粘进 negative 框）：

```
no person, no human, no character, no creature, no text, no watermark, no signature, no logo, cartoon, anime, manga, flat illustration, vector art, pixel art, blurry, low quality, low resolution, oversaturated, plastic, glossy
```
