// spec: plr-d7-m1-multiuser-2026-10-26 (step 1)
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Farms;

/// <summary>
/// spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — the one farm-code generator and reader.
/// A code is what a farmer reads aloud and another farmer types, so the reader must forgive
/// the ways people actually type it, and refuse anything that is not a code (the join route
/// answers a refusal exactly like an unknown code).
/// </summary>
public sealed class FarmCodeTests
{
    [Fact]
    public void New_is_six_characters_of_the_crockford_alphabet()
    {
        for (var i = 0; i < 500; i++)
        {
            var code = FarmCode.New();

            Assert.Equal(FarmCode.Length, code.Length);
            Assert.All(code, c => Assert.Contains(c, FarmCode.Alphabet));
        }
    }

    [Fact]
    public void New_never_uses_the_letters_a_farmer_would_misread()
    {
        Assert.DoesNotContain('I', FarmCode.Alphabet);
        Assert.DoesNotContain('L', FarmCode.Alphabet);
        Assert.DoesNotContain('O', FarmCode.Alphabet);
        Assert.DoesNotContain('U', FarmCode.Alphabet);
        Assert.Equal(32, FarmCode.Alphabet.Distinct().Count());
    }

    [Fact]
    public void New_is_random_not_a_sequence()
    {
        // 2000 draws from ~1.07 billion: a repeat is ~0.2% likely, so allow a couple.
        var codes = Enumerable.Range(0, 2000).Select(_ => FarmCode.New()).ToList();

        Assert.True(codes.Distinct().Count() >= 1998, "codes must not repeat like a counter or a fixed seed");
    }

    [Fact]
    public void A_generated_code_reads_back_as_itself()
    {
        for (var i = 0; i < 200; i++)
        {
            var code = FarmCode.New();
            Assert.Equal(code, FarmCode.Normalize(code));
        }
    }

    [Theory]
    [InlineData("k7m2qp", "K7M2QP")]       // lower case
    [InlineData(" K7M 2QP ", "K7M2QP")]    // spaces, as read aloud in two halves
    [InlineData("K7M-2QP", "K7M2QP")]      // hyphen
    [InlineData("A1B0C1", "A1B0C1")]
    [InlineData("AIB0C1", "A1B0C1")]       // I typed for 1
    [InlineData("ALBOC1", "A1B0C1")]       // L typed for 1, O typed for 0
    [InlineData("albocl", "A1B0C1")]       // ...in lower case too
    [InlineData("K७M२QP", "K7M2QP")]       // digits typed on a Marathi keyboard
    [InlineData("१२३४५६", "123456")]
    public void Normalize_forgives_how_people_type_a_code(string typed, string expected)
    {
        Assert.Equal(expected, FarmCode.Normalize(typed));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("K7M2Q")]                  // too short
    [InlineData("K7M2QPX")]                // too long
    [InlineData("K7M2QU")]                 // U is not in the alphabet
    [InlineData("K7M2Q!")]                 // symbol
    [InlineData("K7M2Q_")]
    [InlineData("K7M2QÉ")]                 // non-ASCII letter
    [InlineData("' OR 1=1 --")]
    public void Normalize_refuses_anything_that_is_not_a_code(string? typed)
    {
        Assert.Null(FarmCode.Normalize(typed));
    }

    [Fact]
    public void A_farm_keeps_the_code_it_is_given_in_upper_case()
    {
        var now = new DateTime(2026, 10, 26, 6, 0, 0, DateTimeKind.Utc);
        var farm = Farm.Create(new FarmId(Guid.NewGuid()), "Code Farm", new UserId(Guid.NewGuid()), now);
        Assert.Null(farm.FarmCode);

        var code = FarmCode.New();
        farm.AssignFarmCode(code.ToLowerInvariant(), now);

        Assert.Equal(code, farm.FarmCode);
    }
}
