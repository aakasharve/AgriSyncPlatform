// spec: dfes-input-truth-and-mix-check-2026-11-06 - founder walk 2026-11-20: a product said on its own is a product
using ShramSafal.Domain.Inputs;
using Xunit;

namespace ShramSafal.Domain.Tests.Inputs;

/// <summary>
/// <see cref="ProductIdentity.ItemsOf"/> names the products of a stored record. A product said on its own (<c>"कराटे"</c>) is stored
/// on the event itself with an empty mix; before this, such a product was invisible to the whole identity system (no row on the review
/// card, no answer, no credit). It is slot 0 of its event; an event whose mix names something keeps the mix only.
/// </summary>
public sealed class ProductIdentityItemsOfTests
{
    [Fact]
    public void AProductSaidOnItsOwn_IsSlotZeroOfItsEvent()
    {
        var items = ProductIdentity.ItemsOf("""{"inputs":[{"id":"e1","method":"Spray","productName":"Karate","mix":[]}]}""");

        var only = Assert.Single(items);
        Assert.Equal(new ProductItem("e1", 0, "Karate", null), only);
    }

    [Fact]
    public void ThePlainShapeWithNoMixAtAll_IsTheSame()
    {
        var items = ProductIdentity.ItemsOf("""{"inputs":[{"id":"e1","productName":"Ethrel","npkGrade":"19:19:19"}]}""");

        Assert.Equal(new ProductItem("e1", 0, "Ethrel", "19:19:19"), Assert.Single(items));
    }

    [Fact]
    public void AnEventWithAMix_KeepsTheMixOnly()
    {
        var items = ProductIdentity.ItemsOf(
            """{"inputs":[{"id":"e1","productName":"Spray tank","mix":[{"productName":"Karate"},{"productName":"Ethrel"}]}]}""");

        Assert.Equal(
            [new ProductItem("e1", 0, "Karate", null), new ProductItem("e1", 1, "Ethrel", null)],
            items);
    }

    [Fact]
    public void NoWords_NoProduct()
    {
        Assert.Empty(ProductIdentity.ItemsOf("""{"inputs":[{"id":"e1","method":"Spray","mix":[]},{"id":"e2","productName":"  ","mix":[]}]}"""));
        Assert.Empty(ProductIdentity.ItemsOf("""{"inputs":[]}"""));
        Assert.Empty(ProductIdentity.ItemsOf("{not json"));
    }

    [Fact]
    public void ProductsOfSeveralEvents_AreListedInDocumentOrder()
    {
        var items = ProductIdentity.ItemsOf(
            """{"inputs":[{"id":"a","productName":"Karate","mix":[]},{"id":"b","mix":[{"productName":"19:19:19"}]},{"id":"c","productName":"Ethrel"}]}""");

        Assert.Equal(["a:0:Karate", "b:0:19:19:19", "c:0:Ethrel"], items.Select(i => $"{i.InputEventId}:{i.MixIndex}:{i.SpokenName}").ToArray());
    }
}
